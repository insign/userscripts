// ==UserScript==
// @name         Summarize with AI (Unified)
// @namespace    https://github.com/insign/userscripts
// @version      2025.02.16.14.56
// @description  Single-button AI summarization (OpenAI/Gemini) with model selection dropdown for articles/news. Uses Alt+S shortcut.
// @author       Hélio <open@helio.me>
// @license      WTFPL
// @match        *://*/*
// @grant        GM.addStyle
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @connect      api.openai.com
// @connect      generativelanguage.googleapis.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/readability/0.5.0/Readability.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/readability/0.5.0/Readability-readerable.min.js
// @downloadURL  https://update.greasyfork.org/scripts/509192/Summarize%20with%20AI%20%28Unified%29.user.js
// @updateURL    https://update.greasyfork.org/scripts/509192/Summarize%20with%20AI%20%28Unified%29.meta.js
// ==/UserScript==

(function() {
	'use strict'

	// IDs dos elementos da interface do script
	const BUTTON_ID       = 'summarize-button'       // Botão principal flutuante
	const DROPDOWN_ID     = 'model-dropdown'         // Dropdown de seleção de modelo
	const OVERLAY_ID      = 'summarize-overlay'      // Overlay de fundo para o sumário
	const CLOSE_BUTTON_ID = 'summarize-close'        // Botão de fechar no overlay
	const CONTENT_ID      = 'summarize-content'      // Div que contém o texto do sumário
	const ERROR_ID        = 'summarize-error'        // Div para exibir notificações de erro

	// Configuração dos serviços e modelos de IA suportados
	const MODEL_GROUPS = {
		openai: {
			name   : 'OpenAI',                           // Nome do serviço
			models : ['gpt-4o-mini', 'o3-mini'], // Modelos disponíveis
			baseUrl: 'https://api.openai.com/v1/chat/completions', // URL base da API
		},
		gemini: {
			name   : 'Gemini',
			models : [                                   // Modelos Gemini disponíveis
				'gemini-2.0-flash-exp', 'gemini-2.0-pro-exp-02-05', 'gemini-2.0-flash-thinking-exp-01-21', 'learnlm-1.5-pro-experimental',
				'gemini-2.0-flash-lite-preview-02-05',
			],
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/', // URL base da API Gemini
		},
	}

	// Template do prompt enviado para a IA
	// Inclui instruções sobre o formato desejado (HTML, introdução, bullets, conclusão) e o idioma.
	const PROMPT_TEMPLATE = (title, content, lang) => `You are a helpful assistant that provides clear and affirmative explanations of content.
Generate a concise summary that includes:
- 2-sentence introduction
- Bullet points with relevant emojis
- No section headers
- Use HTML formatting, but send without \`\`\`html markdown syntax since it will be injected into the page to the browser evaluate correctly
- After the last bullet point add a 2-sentence conclusion using opinionated language based on your general knowledge
- Language: ${lang}

Article Title: ${title}
Article Content: ${content}`

	// Variáveis de estado
	let activeModel = 'gpt-4o-mini' // Modelo selecionado por padrão ou pelo usuário
	let articleData = null          // Armazena o título e conteúdo extraído do artigo

	/**
	 * Função principal de inicialização do script.
	 * Adiciona listener de teclado, tenta extrair dados do artigo,
	 * e se bem-sucedido, adiciona o botão e listeners de foco.
	 */
	function initialize() {
		document.addEventListener('keydown', handleKeyPress) // Listener para o atalho Alt+S
		articleData = getArticleData()                      // Tenta extrair o conteúdo do artigo
		if (articleData) {                                  // Se encontrou conteúdo legível:
			addSummarizeButton()                              // Adiciona o botão flutuante e o dropdown
			showElement(BUTTON_ID)                            // Torna o botão visível
			setupFocusListeners()                             // Configura para esconder/mostrar botão em campos de input
		}
	}

	/**
	 * Tenta extrair o conteúdo principal da página usando a biblioteca Readability.js.
	 * @returns {object|null} - Um objeto { title, content } se bem-sucedido, ou null se não for legível ou ocorrer erro.
	 */
	function getArticleData() {
		try {
			// Clona o documento para não modificar o original
			const docClone = document.cloneNode(true)
			// Remove scripts e estilos do clone para evitar interferências com Readability
			docClone.querySelectorAll('script, style, noscript, iframe, figure, img').forEach(el => el.remove())
			// Verifica se a página é provavelmente legível antes de tentar parsear
			if (!isProbablyReaderable(docClone)) {
				console.log('Summarize with AI: Page not detected as readerable.')
				return null
			}
			const reader = new Readability(docClone)
			const article = reader.parse()
			// Retorna os dados se o conteúdo foi extraído com sucesso
			return article?.content ? { title: article.title, content: article.textContent.trim() } : null
		} catch (error) {
			console.error('Summarize with AI: Article parsing failed:', error)
			return null // Retorna null em caso de erro
		}
	}

	/**
	 * Adiciona o botão flutuante 'S' e o dropdown de seleção de modelo ao DOM.
	 * Configura os event listeners do botão.
	 */
	function addSummarizeButton() {
		// Evita adicionar o botão múltiplas vezes
		if (document.getElementById(BUTTON_ID)) return

		// Cria o botão 'S'
		const button       = document.createElement('div')
		button.id          = BUTTON_ID
		button.textContent = 'S' // Texto simples, mantido pequeno
		document.body.appendChild(button)

		// Cria o dropdown (inicialmente oculto)
		const dropdown = createDropdown()
		document.body.appendChild(dropdown)

		// Listener para clique simples: mostra/esconde o dropdown
		button.addEventListener('click', toggleDropdown)
		// Listener para duplo clique: permite resetar a chave da API
		button.addEventListener('dblclick', handleApiKeyReset)

		// Injeta os estilos CSS necessários para a interface
		injectStyles()
	}

	/**
	 * Cria o elemento do dropdown com os grupos de modelos.
	 * @returns {HTMLElement} - O elemento div do dropdown.
	 */
	function createDropdown() {
		const dropdown         = document.createElement('div')
		dropdown.id            = DROPDOWN_ID
		dropdown.style.display = 'none' // Começa oculto

		// Itera sobre os grupos de modelos (OpenAI, Gemini)
		Object.entries(MODEL_GROUPS).forEach(([service, group]) => {
			const groupDiv     = document.createElement('div')
			groupDiv.className = 'model-group'
			// Adiciona o cabeçalho do grupo (e.g., "OpenAI")
			groupDiv.appendChild(createHeader(group.name))
			// Adiciona cada item de modelo dentro do grupo
			group.models.forEach(model => groupDiv.appendChild(createModelItem(model)))
			dropdown.appendChild(groupDiv) // Adiciona o grupo ao dropdown
		})
		return dropdown
	}

	/**
	 * Cria um elemento de cabeçalho para um grupo de modelos no dropdown.
	 * @param {string} text - O texto do cabeçalho (nome do serviço).
	 * @returns {HTMLElement} - O elemento div do cabeçalho.
	 */
	function createHeader(text) {
		const header       = document.createElement('div')
		header.className   = 'group-header'
		header.textContent = text
		return header
	}

	/**
	 * Cria um item clicável para um modelo específico no dropdown.
	 * @param {string} model - O nome do modelo.
	 * @returns {HTMLElement} - O elemento div do item do modelo.
	 */
	function createModelItem(model) {
		const item       = document.createElement('div')
		item.className   = 'model-item'
		item.textContent = model
		// Listener de clique: seleciona o modelo, esconde dropdown e inicia sumarização
		item.addEventListener('click', () => {
			activeModel = model               // Define o modelo ativo
			hideElement(DROPDOWN_ID)        // Esconde o dropdown
			processSummarization()          // Inicia o processo de sumarização
		})
		return item
	}

	/**
	 * Orquestra o processo de sumarização: obtém API key, mostra overlay de loading,
	 * envia requisição à API e trata a resposta.
	 */
	async function processSummarization() {
		try {
			const service = getCurrentService() // Determina qual serviço (openai/gemini) usar com base no `activeModel`
			const apiKey  = await getApiKey(service) // Obtém a API key (pede ao usuário se não tiver)

			// Aborta se não houver API key
			if (!apiKey) {
				showErrorNotification(`API key for ${service.toUpperCase()} is required. Double-click the 'S' button to set it.`)
				return
			}

			// Mostra o overlay com mensagem de "Summarizing..."
			showSummaryOverlay('<p class="glow">Summarizing...</p>')

			// Prepara os dados para a API
			const payload = { title: articleData.title, content: articleData.content, lang: navigator.language || 'en-US' }

			// Envia a requisição para a API apropriada
			const response = await sendApiRequest(service, apiKey, payload)

			// Processa a resposta da API
			handleApiResponse(response, service)

		} catch (error) {
			// Exibe erros no overlay ou como notificação
			const errorMsg = `Error: ${error.message}`
			console.error('Summarize with AI:', errorMsg)
			if (document.getElementById(OVERLAY_ID)) {
				updateSummaryOverlay(`<p style="color: red;">${errorMsg}</p>`)
			} else {
				showErrorNotification(errorMsg)
			}
			// Garante que o dropdown esteja oculto em caso de erro durante o processamento
			hideElement(DROPDOWN_ID)
		}
	}

	/**
	 * Envia a requisição HTTP para a API de IA (OpenAI ou Gemini).
	 * Usa GM.xmlHttpRequest para contornar restrições de CORS.
	 * @param {string} service - 'openai' ou 'gemini'.
	 * @param {string} apiKey - A chave da API para o serviço.
	 * @param {object} payload - Objeto com { title, content, lang }.
	 * @returns {Promise<object>} - A promessa resolve com o objeto de resposta da requisição.
	 */
	async function sendApiRequest(service, apiKey, payload) {
		// Monta a URL da API baseada no serviço e modelo ativo
		const url = service === 'openai'
				? MODEL_GROUPS.openai.baseUrl
				: `${MODEL_GROUPS.gemini.baseUrl}${activeModel}:generateContent?key=${apiKey}` // Gemini inclui a key na URL

		return new Promise((resolve, reject) => {
			GM.xmlHttpRequest({
				method : 'POST',
				url    : url,
				headers: getHeaders(service, apiKey),           // Obtém os cabeçalhos corretos para o serviço
				data   : JSON.stringify(buildRequestBody(service, payload)), // Constrói o corpo da requisição
				onload : response => resolve(response),        // Resolve a promessa com a resposta em caso de sucesso
				onerror: error => reject(new Error(`Network error: ${error.statusText || 'Failed to connect'}`)), // Rejeita em caso de erro de rede
				onabort: () => reject(new Error('Request aborted')), // Rejeita se a requisição for abortada
				ontimeout: () => reject(new Error('Request timed out')), // Rejeita em caso de timeout
			})
		})
	}

	/**
	 * Processa a resposta da API, extrai o sumário e atualiza o overlay.
	 * @param {object} response - O objeto de resposta da requisição (de GM.xmlHttpRequest).
	 * @param {string} service - 'openai' ou 'gemini'.
	 */
	function handleApiResponse(response, service) {
		// Verifica se o status da resposta HTTP é 200 (OK)
		if (response.status !== 200) {
			let errorDetails = response.statusText
			try {
				// Tenta extrair uma mensagem de erro mais detalhada do corpo da resposta JSON
				const errorData = JSON.parse(response.responseText)
				errorDetails = errorData?.error?.message || errorDetails
			} catch (e) { /* Ignora se não conseguir parsear o JSON do erro */ }
			throw new Error(`API Error (${response.status}): ${errorDetails}`)
		}

		// Parseia o corpo da resposta JSON
		const data = JSON.parse(response.responseText)

		// Extrai o conteúdo do sumário dependendo do serviço
		let summary = ''
		if (service === 'openai') {
			summary = data?.choices?.[0]?.message?.content
		} else if (service === 'gemini') {
			summary = data?.candidates?.[0]?.content?.parts?.[0]?.text
		}

		// Verifica se o sumário foi obtido
		if (!summary) {
			throw new Error('API response did not contain a valid summary.')
		}

		// Atualiza o overlay com o sumário formatado (substitui novas linhas por <br>)
		updateSummaryOverlay(summary.replace(/\n/g, '<br>'))
	}

	/**
	 * Constrói o corpo (payload) da requisição para a API, formatado corretamente
	 * para OpenAI ou Gemini.
	 * @param {string} service - 'openai' ou 'gemini'.
	 * @param {object} payload - Objeto com { title, content, lang }.
	 * @returns {object} - O objeto do corpo da requisição.
	 */
	function buildRequestBody(service, { title, content, lang }) {
		const systemPrompt = PROMPT_TEMPLATE(title, content, lang) // Gera o prompt do sistema

		if (service === 'openai') {
			return {
				model    : activeModel,
				messages : [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: 'Generate the summary as requested.' }, // Mensagem curta do usuário
				],
				temperature: 0.5, // Controla a criatividade/determinismo
				max_tokens : 500, // Limita o tamanho da resposta
			}
		} else { // gemini
			return {
				contents: [
					{
						parts: [
							{ text: systemPrompt }, // Gemini usa uma estrutura diferente
						],
					},
				],
				// Configurações de geração podem ser adicionadas aqui se necessário (e suportado pelo modelo)
				// "generationConfig": { "temperature": 0.5, "maxOutputTokens": 500 }
			}
		}
	}

	/**
	 * Retorna os cabeçalhos HTTP apropriados para a requisição da API.
	 * OpenAI requer 'Authorization: Bearer <key>'. Gemini não (key na URL).
	 * @param {string} service - 'openai' ou 'gemini'.
	 * @param {string} apiKey - A chave da API.
	 * @returns {object} - O objeto de cabeçalhos.
	 */
	function getHeaders(service, apiKey) {
		const headers = { 'Content-Type': 'application/json' }
		if (service === 'openai') {
			headers['Authorization'] = `Bearer ${apiKey}`
		}
		return headers
	}

	/**
	 * Determina qual serviço ('openai' ou 'gemini') corresponde ao `activeModel` atual.
	 * @returns {string|undefined} - O nome do serviço ou undefined se não encontrado.
	 */
	function getCurrentService() {
		// Encontra a chave (nome do serviço) cujo array `models` inclui o `activeModel`
		return Object.keys(MODEL_GROUPS).find(service => MODEL_GROUPS[service].models.includes(activeModel))
	}

	/**
	 * Mostra ou esconde o dropdown de seleção de modelo.
	 * @param {Event} e - O objeto do evento de clique.
	 */
	function toggleDropdown(e) {
		e.stopPropagation() // Impede que o clique se propague para o document (que fecharia o dropdown)
		const dropdown = document.getElementById(DROPDOWN_ID)
		if (dropdown) {
			dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none'
		}
	}

	/**
	 * Manipulador para o atalho de teclado (Alt+S).
	 * Simula um clique no botão 'S' se ele existir.
	 * @param {KeyboardEvent} e - O objeto do evento de teclado.
	 */
	function handleKeyPress(e) {
		if (e.altKey && e.code === 'KeyS') { // Verifica se Alt+S foi pressionado
			e.preventDefault() // Previne a ação padrão do navegador (ex: abrir menu de histórico)
			const button = document.getElementById(BUTTON_ID)
			if (button) {
				// Se o dropdown estiver visível, esconde; senão, mostra (simula clique)
				const dropdown = document.getElementById(DROPDOWN_ID)
				if (dropdown && dropdown.style.display === 'block') {
					hideElement(DROPDOWN_ID)
				} else {
					button.click()
				}
			}
		}
		// Fecha o overlay ou dropdown com a tecla Esc
		if (e.key === 'Escape') {
			closeOverlay()
			hideElement(DROPDOWN_ID)
		}
	}

	/**
	 * Obtém a chave da API para o serviço especificado a partir do armazenamento (GM.getValue).
	 * Se não existir, pede ao usuário via prompt e armazena (GM.setValue).
	 * @param {string} service - 'openai' ou 'gemini'.
	 * @returns {Promise<string|null>} - A chave da API ou null se não for fornecida.
	 */
	async function getApiKey(service) {
		const storageKey = `${service}_api_key` // Chave usada para armazenar a API key
		let apiKey       = await GM.getValue(storageKey) // Tenta ler do armazenamento

		if (!apiKey) {
			// Pede ao usuário se não encontrou a chave
			apiKey = prompt(`Enter your ${service.toUpperCase()} API key:`)
			if (apiKey) {
				apiKey = apiKey.trim() // Remove espaços extras
				await GM.setValue(storageKey, apiKey) // Salva a chave fornecida
			} else {
				return null // Retorna null se o usuário cancelar ou não inserir nada
			}
		}
		return apiKey?.trim() // Retorna a chave (do armazenamento ou recém-inserida)
	}

	/**
	 * Permite ao usuário resetar (redefinir) a chave da API para um serviço.
	 * Ativado por duplo clique no botão 'S'.
	 */
	async function handleApiKeyReset() {
		// Pergunta para qual serviço resetar
		const service = prompt('Reset API key for which service? (openai / gemini)')?.toLowerCase()?.trim()

		if (service && MODEL_GROUPS[service]) { // Verifica se o serviço é válido
			// Pede a nova chave
			const newKey = prompt(`Enter the new ${service.toUpperCase()} API key (leave blank to clear):`)
			if (newKey !== null) { // Verifica se o usuário não cancelou
				await GM.setValue(`${service}_api_key`, newKey.trim()) // Salva a nova chave (ou string vazia para limpar)
				alert(`${service.toUpperCase()} API key updated!`)
			}
		} else if (service) {
			alert('Invalid service name. Please enter "openai" or "gemini".')
		}
	}

	/**
	 * Injeta os estilos CSS necessários para a interface do script na página.
	 * Usa GM.addStyle para adicionar os estilos.
	 */
	function injectStyles() {
		GM.addStyle(`
      #${BUTTON_ID} {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 50px; /* Reduzido um pouco */
        height: 50px; /* Reduzido um pouco */
        background: linear-gradient(145deg, #3a7bd5, #00d2ff); /* Gradiente azul */
        color: white;
        font-size: 24px; /* Reduzido um pouco */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        border-radius: 50%;
        cursor: pointer;
        z-index: 2147483640; /* Z-index alto mas permite outros elementos acima se necessário */
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        display: flex !important; /* Usa flex para centralizar */
        align-items: center !important;
        justify-content: center !important;
        transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
        line-height: 1; /* Garante alinhamento vertical */
        user-select: none; /* Impede seleção de texto */
      }
      #${BUTTON_ID}:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
      }
      #${DROPDOWN_ID} {
        position: fixed;
        bottom: 80px; /* Ajustado para ficar acima do botão */
        right: 20px;
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 10px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
        z-index: 2147483641; /* Acima do botão */
        max-height: 70vh; /* Altura máxima */
        overflow-y: auto; /* Scroll se necessário */
        padding: 8px; /* Espaçamento interno */
        width: 300px; /* Largura do dropdown */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        display: none; /* Começa oculto */
        animation: fadeIn 0.2s ease-out; /* Animação de entrada */
      }
      .model-group {
        margin-bottom: 8px; /* Espaço entre grupos */
      }
      .group-header {
        padding: 8px 12px;
        font-weight: 600;
        color: #333;
        background: #f7f7f7;
        border-radius: 6px;
        margin-bottom: 4px;
        font-size: 13px; /* Tamanho ligeiramente menor */
        text-transform: uppercase; /* Caixa alta */
        letter-spacing: 0.5px; /* Espaçamento entre letras */
      }
      .model-item {
        padding: 10px 14px;
        margin: 2px 0;
        border-radius: 6px;
        transition: background-color 0.15s ease-out, color 0.15s ease-out;
        font-size: 14px;
        cursor: pointer;
        color: #444;
        display: block; /* Garante que ocupe toda a largura */
      }
      .model-item:hover {
        background-color: #eef6ff; /* Azul claro no hover */
        color: #1a73e8; /* Azul mais escuro no hover */
      }
      #${OVERLAY_ID} {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.6); /* Fundo semi-transparente mais escuro */
        z-index: 2147483645; /* Z-index muito alto */
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden; /* Impede scroll do body enquanto aberto */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        animation: fadeIn 0.3s ease-out;
      }
      #${CONTENT_ID} {
        background-color: #fff;
        padding: 25px 35px; /* Ajuste no padding */
        border-radius: 12px; /* Bordas mais arredondadas */
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        max-width: 800px; /* Largura máxima aumentada */
        width: 90%; /* Largura responsiva */
        max-height: 85vh; /* Altura máxima */
        overflow-y: auto; /* Scroll vertical se necessário */
        position: relative;
        font-size: 16px; /* Tamanho de fonte base */
        line-height: 1.6; /* Espaçamento entre linhas */
        color: #333;
        animation: slideInUp 0.3s ease-out; /* Animação de entrada */
      }
      #${CONTENT_ID} ul { padding-left: 25px; margin-top: 10px; } /* Estilo para listas */
      #${CONTENT_ID} li { margin-bottom: 8px; } /* Espaçamento entre itens da lista */
      #${CLOSE_BUTTON_ID} {
        position: absolute;
        top: 10px;
        right: 15px;
        font-size: 28px;
        color: #aaa;
        cursor: pointer;
        transition: color 0.2s;
        line-height: 1;
      }
      #${CLOSE_BUTTON_ID}:hover {
        color: #333; /* Cor mais escura no hover */
      }
      #${ERROR_ID} {
        position: fixed;
        bottom: 20px;
        left: 50%; /* Centralizado horizontalmente */
        transform: translateX(-50%); /* Ajuste fino da centralização */
        background-color: #e53e3e; /* Vermelho para erro */
        color: white;
        padding: 12px 20px;
        border-radius: 6px;
        z-index: 2147483646; /* Acima do overlay */
        font-size: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        animation: fadeIn 0.3s, fadeOut 0.3s 3.7s; /* Fade in e fade out */
      }
      .glow {
        font-size: 1.4em; /* Tamanho um pouco menor */
        color: #555;
        text-align: center;
        padding: 40px 0; /* Espaçamento vertical */
        animation: glow 1.8s ease-in-out infinite alternate;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-weight: 300; /* Fonte mais leve */
      }

      /* Animações */
      @keyframes glow {
        from { color: #4a90e2; text-shadow: 0 0 8px rgba(74, 144, 226, 0.5); }
        to { color: #7aa7d6; text-shadow: 0 0 15px rgba(122, 167, 214, 0.7); }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
      @keyframes slideInUp {
         from { transform: translateY(30px); opacity: 0; }
         to { transform: translateY(0); opacity: 1; }
      }
    `)
	}

	/**
	 * Exibe o overlay de sumarização com o conteúdo fornecido.
	 * Cria o overlay se ele não existir.
	 * @param {string} contentHTML - O conteúdo HTML a ser exibido (pode ser mensagem de loading ou o sumário).
	 */
	function showSummaryOverlay(contentHTML) {
		// Se o overlay já existe, apenas atualiza o conteúdo
		if (document.getElementById(OVERLAY_ID)) {
			updateSummaryOverlay(contentHTML)
			return
		}

		// Cria o elemento do overlay
		const overlay = document.createElement('div')
		overlay.id    = OVERLAY_ID
		overlay.innerHTML = `
      <div id="${CONTENT_ID}">
        <div id="${CLOSE_BUTTON_ID}" title="Close (Esc)">×</div>
        ${contentHTML}
      </div>
    `
		document.body.appendChild(overlay)
		document.body.style.overflow = 'hidden' // Trava o scroll do body

		// Adiciona listeners para fechar o overlay
		document.getElementById(CLOSE_BUTTON_ID).addEventListener('click', closeOverlay)
		// Fecha clicando fora da caixa de conteúdo
		overlay.addEventListener('click', (e) => {
			// Verifica se o clique foi diretamente no overlay (fundo) e não dentro do content
			if (e.target === overlay) {
				closeOverlay()
			}
		})
		// Listener global de teclado para fechar com Esc já está em handleKeyPress
	}

	/**
	 * Fecha e remove o overlay de sumarização do DOM.
	 * Restaura o scroll do body.
	 */
	function closeOverlay() {
		const overlay = document.getElementById(OVERLAY_ID)
		if (overlay) {
			overlay.remove()
			document.body.style.overflow = '' // Libera o scroll do body
		}
	}


	/**
	 * Atualiza o conteúdo dentro do overlay de sumarização já existente.
	 * @param {string} contentHTML - O novo conteúdo HTML.
	 */
	function updateSummaryOverlay(contentHTML) {
		const contentDiv = document.getElementById(CONTENT_ID)
		if (contentDiv) {
			// Recria o conteúdo interno, incluindo o botão de fechar
			contentDiv.innerHTML = `<div id="${CLOSE_BUTTON_ID}" title="Close (Esc)">×</div>${contentHTML}`
			// Reatribui o listener ao novo botão de fechar
			document.getElementById(CLOSE_BUTTON_ID).addEventListener('click', closeOverlay)
		}
	}

	/**
	 * Exibe uma notificação de erro temporária na parte inferior da tela.
	 * @param {string} message - A mensagem de erro.
	 */
	function showErrorNotification(message) {
		// Remove notificação anterior se existir
		document.getElementById(ERROR_ID)?.remove()

		// Cria a div de erro
		const errorDiv     = document.createElement('div')
		errorDiv.id        = ERROR_ID
		errorDiv.innerText = message
		document.body.appendChild(errorDiv)

		// Remove a notificação após 4 segundos
		setTimeout(() => errorDiv.remove(), 4000)
	}

	/**
	 * Esconde um elemento pelo seu ID.
	 * @param {string} id - O ID do elemento.
	 */
	function hideElement(id) {
		const el = document.getElementById(id)
		if (el) el.style.display = 'none'
	}

	/**
	 * Mostra um elemento pelo seu ID (assumindo display 'block' ou 'flex' dependendo do elemento).
	 * @param {string} id - O ID do elemento.
	 */
	function showElement(id) {
		const el = document.getElementById(id)
		if (el) {
			// Usa 'flex' para o botão e 'block' para os outros por padrão
			el.style.display = (id === BUTTON_ID) ? 'flex' : 'block'
		}
	}

	/**
	 * Configura listeners para esconder o botão 'S' quando um campo de input/textarea ganha foco,
	 * e mostrar novamente quando perde o foco.
	 */
	function setupFocusListeners() {
		// Listener para quando um elemento ganha foco
		document.addEventListener('focusin', (event) => {
			toggleButtonVisibility(event.target)
		})
		// Listener para quando um elemento perde foco (menos direto, usamos focusin)
		// 'focusout' pode ser complicado com elementos desaparecendo. 'focusin' é mais robusto aqui.
		// Adicionamos um listener de clique no documento para garantir que o botão reapareça
		// ao clicar fora de um input.
		document.addEventListener('click', (event) => {
			// Se o clique não foi no botão ou no dropdown, e o foco não está num input, mostra o botão
			if (!event.target.closest(`#${BUTTON_ID}`) && !event.target.closest(`#${DROPDOWN_ID}`)) {
				const active = document.activeElement
				const isInput = active?.matches('input, textarea, select, [contenteditable="true"]')
				if (!isInput) {
					// Apenas mostra se o artigo foi detectado
					if (articleData) {
						showElement(BUTTON_ID)
					}
				}
			}
		}, true) // Usa captura para pegar o evento antes
	}

	/**
	 * Mostra ou esconde o botão 'S' com base no elemento que tem o foco.
	 * @param {Element} focusedElement - O elemento que recebeu ou perdeu foco.
	 */
	function toggleButtonVisibility(focusedElement) {
		const button = document.getElementById(BUTTON_ID)
		if (!button || !articleData) return // Só age se o botão existir e o artigo for válido

		// Verifica se o elemento focado (ou um de seus pais) é um campo de entrada
		const isInput = focusedElement?.closest('input, textarea, select, [contenteditable="true"]')

		// Esconde o botão se for um input, mostra caso contrário
		if (isInput) {
			hideElement(BUTTON_ID)
			hideElement(DROPDOWN_ID) // Esconde também o dropdown por segurança
		} else {
			showElement(BUTTON_ID)
		}
	}

	// Inicia o script
	initialize()

})()
