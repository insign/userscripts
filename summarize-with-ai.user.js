// ==UserScript==
// @name         Summarize with AI
// @namespace    https://github.com/insign/userscripts
// @version      2025.02.05.1805 // Refatoração MODEL_GROUPS, params por modelo, correção Gemini
// @description  Single-button AI summarization (OpenAI/Gemini) with model selection dropdown for articles/news. Uses Alt+S shortcut. Allows adding custom models.
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

(function () {
	'use strict'

	// --- Constantes ---
	// IDs dos elementos da interface do script
	const BUTTON_ID         = 'summarize-button'       // Botão principal flutuante 'S'
	const DROPDOWN_ID       = 'model-dropdown'         // Dropdown de seleção de modelo
	const OVERLAY_ID        = 'summarize-overlay'      // Overlay de fundo para o sumário
	const CLOSE_BUTTON_ID   = 'summarize-close'        // Botão de fechar no overlay
	const CONTENT_ID        = 'summarize-content'      // Div que contém o texto do sumário
	const ERROR_ID          = 'summarize-error'        // Div para exibir notificações de erro
	const ADD_MODEL_ITEM_ID = 'add-custom-model'       // ID para o item "Adicionar Modelo" no dropdown

	// Chave para armazenar modelos customizados no GM storage
	const CUSTOM_MODELS_KEY = 'custom_ai_models'

	// Limite de tokens padrão
	const DEFAULT_MAX_TOKENS = 1000
	// Limite de tokens alto (para modelos específicos)
	const HIGH_MAX_TOKENS    = 1500

	// Configuração dos serviços e modelos de IA *padrão* suportados
	// Nova estrutura: models é um array de objetos com id, name (opcional), params (opcional)
	const MODEL_GROUPS = {
		openai: {
			name:    'OpenAI',
			baseUrl: 'https://api.openai.com/v1/chat/completions',
			models:  [
				{id: 'o4-mini', name: 'o4 mini (better)', params: {max_completion_tokens: HIGH_MAX_TOKENS}},
				{id: 'o3-mini', name: 'o3 mini', params: {max_completion_tokens: HIGH_MAX_TOKENS}}, // Nome pode precisar de ajuste
				{id: 'gpt-4.1', name: 'GPT-4.1'}, // Usa params padrão
				{id: 'gpt-4.1-mini', name: 'GPT-4.1 mini'},
				{id: 'gpt-4.1-nano', name: 'GPT-4.1 nano (faster)'},
			],
			// Parâmetros padrão específicos para OpenAI (se não definidos no modelo)
			defaultParams: {max_completion_tokens: DEFAULT_MAX_TOKENS}
		},
		gemini: {
			name:    'Gemini',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/',
			models:  [
				{id:      'gemini-2.5-flash-preview-04-17',
					name:   'Gemini 2.5 Flash (faster)',
					params: {maxOutputTokens: HIGH_MAX_TOKENS}
				},
				{id: 'gemini-2.5-pro-exp-03-25', name: 'Gemini 2.5 Pro (better)', params: {maxOutputTokens: HIGH_MAX_TOKENS}},
			],
			// Parâmetros padrão específicos para Gemini (se não definidos no modelo)
			defaultParams: {maxOutputTokens: DEFAULT_MAX_TOKENS} // Mantemos o padrão original aqui
		},
	}

	// Template do prompt enviado para a IA
	const PROMPT_TEMPLATE = (title, content, lang) => `You are a helpful assistant that provides clear and affirmative explanations of content.
Generate a concise summary that includes:
- 2-sentence introduction
- Relevant emojis as bullet points
- No section headers
- Use HTML formatting, never use \`\`\` code blocks, never use markdown.
- After the last bullet point add a 2-sentence conclusion with your own opinion based on your general knowledge, including if you agree or disagree and why. Give your opinion as a human.
- Language: ${lang}

Article Title: ${title}
Article Content: ${content}`

	// --- Variáveis de Estado ---
	let activeModel  = 'gemini-2.5-flash-preview-04-17' // ID do modelo ativo selecionado por padrão ou pelo usuário
	let articleData  = null                             // Armazena o título e conteúdo extraído do artigo { title, content }
	let customModels = []                              // Array para armazenar modelos customizados carregados do storage { id, service }

	// --- Funções Principais ---

	/**
	 * Função principal de inicialização do script.
	 * Carrega modelos customizados, adiciona listener de teclado,
	 * tenta extrair dados do artigo, e se bem-sucedido, adiciona o botão e listeners de foco.
	 */
	async function initialize() {
		customModels = await getCustomModels() // Carrega modelos customizados do storage
		document.addEventListener('keydown', handleKeyPress) // Listener para atalhos (Alt+S, Esc)
		articleData = getArticleData()         // Tenta extrair o conteúdo do artigo
		if (articleData) {                     // Se encontrou conteúdo legível:
			addSummarizeButton()                 // Adiciona o botão flutuante e o dropdown
			showElement(BUTTON_ID)               // Torna o botão visível
			setupFocusListeners()                // Configura para esconder/mostrar botão em campos de input
			// Define o último modelo usado (ou padrão) como ativo
			activeModel = await GM.getValue('last_used_model', activeModel)
		}
	}

	/**
	 * Tenta extrair o conteúdo principal da página usando a biblioteca Readability.js.
	 * @returns {object|null} - Um objeto { title, content } se bem-sucedido, ou null se não for legível ou ocorrer erro.
	 */
	function getArticleData() {
		try {
			const docClone = document.cloneNode(true) // Clona o documento para não modificar o original
			// Remove elementos que podem interferir com a extração
			docClone.querySelectorAll('script, style, noscript, iframe, figure, img, svg, header, footer, nav').forEach(el => el.remove())
			// Verifica se a página é provavelmente legível
			if (!isProbablyReaderable(docClone)) {
				console.log('Summarize with AI: Page not detected as readerable.')
				return null
			}
			const reader = new Readability(docClone)
			const article = reader.parse()
			// Retorna dados se o conteúdo foi extraído e não está vazio
			return (article?.content && article.textContent?.trim())
					? {title: article.title, content: article.textContent.trim()}
					: null
		} catch (error) {
			console.error('Summarize with AI: Article parsing failed:', error)
			return null // Retorna null em caso de erro
		}
	}

	/**
	 * Adiciona o botão flutuante 'S' e o dropdown de seleção de modelo ao DOM.
	 * Configura os event listeners do botão e injeta estilos.
	 */
	function addSummarizeButton() {
		// Evita adicionar o botão múltiplas vezes
		if (document.getElementById(BUTTON_ID)) return

		// Cria o botão 'S'
		const button       = document.createElement('div')
		button.id          = BUTTON_ID
		button.textContent = 'S' // Texto simples e pequeno
		button.title       = 'Summarize (Alt+S) / Dbl-Click to Reset API Key' // Tooltip
		document.body.appendChild(button)

		// Cria o dropdown (inicialmente oculto)
		const dropdown = createDropdownElement() // Cria o elemento base do dropdown
		document.body.appendChild(dropdown)
		populateDropdown(dropdown) // Preenche o dropdown com modelos

		// Listener para clique simples: mostra/esconde o dropdown
		button.addEventListener('click', toggleDropdown)
		// Listener para duplo clique: permite resetar a chave da API
		button.addEventListener('dblclick', handleApiKeyReset)
		// Listener para clique fora do dropdown para fechá-lo
		document.addEventListener('click', handleOutsideClick)

		// Injeta os estilos CSS necessários para a interface
		injectStyles()
	}

	// --- Funções de UI (Dropdown, Overlay, Notificações) ---

	/**
	 * Cria o elemento base (container) do dropdown.
	 * @returns {HTMLElement} - O elemento div do dropdown, inicialmente vazio e oculto.
	 */
	function createDropdownElement() {
		const dropdown         = document.createElement('div')
		dropdown.id            = DROPDOWN_ID
		dropdown.style.display = 'none' // Começa oculto
		return dropdown
	}

	/**
	 * Preenche o elemento dropdown com os grupos de modelos (padrão e customizados)
	 * e a opção para adicionar novos modelos. Usa a nova estrutura de MODEL_GROUPS.
	 * @param {HTMLElement} dropdownElement - O elemento do dropdown a ser preenchido.
	 */
	function populateDropdown(dropdownElement) {
		dropdownElement.innerHTML = '' // Limpa conteúdo anterior

		Object.entries(MODEL_GROUPS).forEach(([service, group]) => {
			// Combina modelos padrão e customizados para este serviço
			const standardModels      = group.models || [] // Array de objetos {id, name?, params?}
			const serviceCustomModels = customModels
					.filter(m => m.service === service) // Filtra customizados por serviço {id, service}
					.map(m => ({id: m.id})) // Mapeia para o formato {id}, sem name ou params definidos aqui

			const allModelObjects = [...standardModels, ...serviceCustomModels]
					// Remove duplicatas baseadas no ID (case-insensitive)
					.reduce((acc, model) => {
						if (!acc.some(existing => existing.id.toLowerCase() === model.id.toLowerCase())) {
							acc.push(model)
						}
						return acc
					}, [])
					.sort((a, b) => a.id.localeCompare(b.id)) // Ordena alfabeticamente pelo ID

			if (allModelObjects.length > 0) {
				const groupDiv     = document.createElement('div')
				groupDiv.className = 'model-group'
				groupDiv.appendChild(createHeader(group.name)) // Adiciona cabeçalho do grupo
				// Adiciona cada item de modelo
				allModelObjects.forEach(modelObj => groupDiv.appendChild(createModelItem(modelObj)))
				dropdownElement.appendChild(groupDiv)
			}
		})

		// Adiciona separador e item "+ Adicionar"
		const separator           = document.createElement('hr')
		separator.style.margin    = '8px 0'
		separator.style.border    = 'none'
		separator.style.borderTop = '1px solid #eee'
		dropdownElement.appendChild(separator)
		dropdownElement.appendChild(createAddModelItem())
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
	 * Usa a nova estrutura de objeto do modelo.
	 * @param {object} modelObj - O objeto do modelo { id, name?, params? }.
	 * @returns {HTMLElement} - O elemento div do item do modelo.
	 */
	function createModelItem(modelObj) {
		const item       = document.createElement('div')
		item.className   = 'model-item'
		// Usa o nome amigável se disponível, senão o ID
		item.textContent = modelObj.name || modelObj.id
		// Adiciona um marcador visual se for o modelo ativo atualmente
		if (modelObj.id === activeModel) {
			item.style.fontWeight = 'bold'
			item.style.color      = '#1A73E8' // Azul para destacar
		}
		// Listener de clique: seleciona o ID do modelo, esconde dropdown e inicia sumarização
		item.addEventListener('click', async () => {
			activeModel = modelObj.id // Define o ID do modelo ativo
			await GM.setValue('last_used_model', activeModel) // Salva a última seleção
			hideElement(DROPDOWN_ID) // Esconde o dropdown
			processSummarization() // Inicia o processo de sumarização
		})
		return item
	}

	/**
	 * Cria o item clicável "+ Adicionar Modelo Customizado" no dropdown.
	 * @returns {HTMLElement} - O elemento div do item.
	 */
	function createAddModelItem() {
		const item       = document.createElement('div')
		item.id          = ADD_MODEL_ITEM_ID
		item.className   = 'model-item add-model-item' // Classe adicional para estilização
		item.textContent = '+ Add Custom Model'
		// Listener de clique: inicia o fluxo para adicionar um novo modelo
		item.addEventListener('click', async () => {
			hideElement(DROPDOWN_ID) // Esconde o dropdown antes de mostrar os prompts
			await handleAddModel()
		})
		return item
	}

	/**
	 * Mostra ou esconde o dropdown de seleção de modelo.
	 * @param {Event} [e] - O objeto do evento de clique (opcional).
	 */
	function toggleDropdown(e) {
		if (e) e.stopPropagation() // Impede que o clique feche imediatamente o dropdown
		const dropdown = document.getElementById(DROPDOWN_ID)
		if (dropdown) {
			const isHidden = dropdown.style.display === 'none'
			if (isHidden) {
				// Repopula o dropdown caso modelos tenham sido adicionados/removidos
				populateDropdown(dropdown)
				showElement(DROPDOWN_ID)
			} else {
				hideElement(DROPDOWN_ID)
			}
		}
	}

	/**
	 * Fecha o dropdown se o clique ocorrer fora dele ou do botão 'S'.
	 * @param {Event} event - O objeto do evento de clique.
	 */
	function handleOutsideClick(event) {
		const dropdown = document.getElementById(DROPDOWN_ID)
		const button   = document.getElementById(BUTTON_ID)
		// Verifica se o dropdown está visível e se o clique foi fora dele e fora do botão
		if (dropdown && dropdown.style.display !== 'none' &&
				!dropdown.contains(event.target) &&
				!button.contains(event.target)) {
			hideElement(DROPDOWN_ID)
		}
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
		const overlay     = document.createElement('div')
		overlay.id        = OVERLAY_ID
		// Define o HTML interno com container, botão de fechar e conteúdo inicial
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
		overlay.addEventListener('click', (e) => { // Fecha clicando no fundo (fora do content)
			if (e.target === overlay) closeOverlay()
		})
		// Listener global de teclado para fechar com Esc já está em handleKeyPress
	}

	/**
	 * Fecha e remove o overlay de sumarização do DOM. Restaura o scroll do body.
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
			// Recria o conteúdo interno, garantindo que o botão de fechar permaneça
			contentDiv.innerHTML = `<div id="${CLOSE_BUTTON_ID}" title="Close (Esc)">×</div>${contentHTML}`
			// Reatribui o listener ao novo botão de fechar
			document.getElementById(CLOSE_BUTTON_ID)?.addEventListener('click', closeOverlay)
		}
	}

	/**
	 * Exibe uma notificação de erro temporária na parte inferior central da tela.
	 * @param {string} message - A mensagem de erro.
	 */
	function showErrorNotification(message) {
		document.getElementById(ERROR_ID)?.remove() // Remove notificação anterior

		const errorDiv     = document.createElement('div')
		errorDiv.id        = ERROR_ID
		errorDiv.innerText = message
		document.body.appendChild(errorDiv)

		// Remove a notificação após 4 segundos
		setTimeout(() => errorDiv.remove(), 4000)
	}

	/**
	 * Esconde um elemento pelo seu ID, definindo display como 'none'.
	 * @param {string} id - O ID do elemento.
	 */
	function hideElement(id) {
		const el = document.getElementById(id)
		if (el) el.style.display = 'none'
	}

	/**
	 * Mostra um elemento pelo seu ID.
	 * @param {string} id - O ID do elemento.
	 */
	function showElement(id) {
		const el = document.getElementById(id)
		if (el) {
			// Usa 'flex' para o botão e 'block' para os outros por padrão
			el.style.display = (id === BUTTON_ID) ? 'flex' : 'block'
		}
	}

	// --- Funções de Lógica (Sumarização, API, Modelos) ---

	/**
	 * Encontra o objeto de configuração completo para o modelo ativo (padrão ou customizado).
	 * @returns {object|null} Um objeto contendo { id, service, name?, params? } ou null se não encontrado.
	 */
	function getActiveModelConfig() {
		for (const service in MODEL_GROUPS) {
			const group       = MODEL_GROUPS[service]
			const modelConfig = group.models.find(m => m.id === activeModel)
			if (modelConfig) {
				return {...modelConfig, service: service} // Adiciona a chave do serviço
			}
		}
		// Verifica modelos customizados
		const customConfig = customModels.find(m => m.id === activeModel)
		if (customConfig) {
			// Custom models não tem 'name' ou 'params' definidos por padrão aqui
			return {...customConfig} // Retorna { id, service }
		}
		return null // Modelo não encontrado
	}

	/**
	 * Orquestra o processo de sumarização: obtém API key, mostra overlay de loading,
	 * envia requisição à API e trata a resposta.
	 */
	async function processSummarization() {
		try {
			const modelConfig = getActiveModelConfig() // Obtém a configuração completa do modelo ativo
			if (!modelConfig) throw new Error(`Configuration for model not found: ${activeModel}`)

			const service = modelConfig.service // Determina 'openai' ou 'gemini' a partir da config

			const apiKey = await getApiKey(service) // Obtém a API key (pede ao usuário se não tiver)
			if (!apiKey) { // Aborta se não houver API key
				showErrorNotification(`API key for ${service.toUpperCase()} is required. Double-click the 'S' button to set it.`)
				return
			}

			showSummaryOverlay('<p class="glow">Summarizing...</p>') // Mostra feedback de loading

			// Prepara os dados para a API
			const payload = {title: articleData.title, content: articleData.content, lang: navigator.language || 'en-US'}

			// Passa a configuração do modelo para sendApiRequest
			const response = await sendApiRequest(service, apiKey, payload, modelConfig)

			handleApiResponse(response, service) // Processa a resposta

		} catch (error) {
			// Exibe erros no overlay ou como notificação
			const errorMsg = `Error: ${error.message}`
			console.error('Summarize with AI:', errorMsg, error) // Loga o erro completo
			if (document.getElementById(OVERLAY_ID)) {
				updateSummaryOverlay(`<p style="color: red;">${errorMsg}</p>`)
			} else {
				showErrorNotification(errorMsg)
			}
			hideElement(DROPDOWN_ID) // Garante que o dropdown esteja oculto em caso de erro
		}
	}

	/**
	 * Envia a requisição HTTP para a API de IA (OpenAI ou Gemini).
	 * @param {string} service - 'openai' ou 'gemini'.
	 * @param {string} apiKey - A chave da API para o serviço.
	 * @param {object} payload - Objeto com { title, content, lang }.
	 * @param {object} modelConfig - Configuração do modelo ativo { id, service, name?, params? }.
	 * @returns {Promise<object>} - A promessa resolve com o objeto de resposta da requisição.
	 */
	async function sendApiRequest(service, apiKey, payload, modelConfig) {
		const group = MODEL_GROUPS[service]
		const url   = service === 'openai'
				? group.baseUrl // URL base da OpenAI
				: `${group.baseUrl}${modelConfig.id}:generateContent?key=${apiKey}` // URL Gemini (inclui ID do modelo e key)

		return new Promise((resolve, reject) => {
			GM.xmlHttpRequest({
				method:  'POST',
				url:     url,
				headers: getHeaders(service, apiKey), // Cabeçalhos específicos do serviço
				// Passa modelConfig para construir o corpo corretamente
				data:         JSON.stringify(buildRequestBody(service, payload, modelConfig)),
				responseType: 'json', // Espera uma resposta JSON
				timeout:      60000, // Timeout de 60 segundos
				onload:       response => {
					// GM.xmlHttpRequest pode retornar response.response em vez de responseText para JSON
					const responseData = response.response || response.responseText
					// Resolve com um objeto contendo status e dados parseados (ou texto original)
					resolve({
						status:     response.status,
						data:       typeof responseData === 'object' ? responseData : JSON.parse(responseData || '{}'),
						statusText: response.statusText,
					})
				},
				onerror:      error => reject(new Error(`Network error: ${error.statusText || 'Failed to connect'}`)),
				onabort:      () => reject(new Error('Request aborted')),
				ontimeout:    () => reject(new Error('Request timed out')),
			})
		})
	}

	/**
	 * Processa a resposta da API, extrai o sumário e atualiza o overlay.
	 * Adiciona log para o finish_reason e tratamento mais robusto para Gemini.
	 * @param {object} response - O objeto de resposta resolvido da Promise de `sendApiRequest` (contém status, data).
	 * @param {string} service - 'openai' ou 'gemini'.
	 */
	function handleApiResponse(response, service) {
		const {status, data, statusText} = response

		// Verifica se o status HTTP indica sucesso (2xx)
		if (status < 200 || status >= 300) {
			// Tenta extrair uma mensagem de erro mais detalhada do corpo da resposta
			const errorDetails = data?.error?.message || statusText || 'Unknown API error'
			throw new Error(`API Error (${status}): ${errorDetails}`)
		}

		// Extrai o conteúdo do sumário dependendo do serviço
		let summary = ''
		if (service === 'openai') {
			const choice = data?.choices?.[0]
			summary      = choice?.message?.content

			// Loga o motivo pelo qual a geração parou
			const finishReason = choice?.finish_reason
			console.log(`Summarize with AI: OpenAI Finish Reason: ${finishReason} (Model: ${activeModel})`)
			if (finishReason === 'length') {
				console.warn('Summarize with AI: Summary may be incomplete because the max token limit was reached.')
			}

		} else if (service === 'gemini') {
			const candidate    = data?.candidates?.[0]
			const finishReason = candidate?.finishReason
			console.log(`Summarize with AI: Gemini Finish Reason: ${finishReason} (Model: ${activeModel})`)

			if (finishReason === 'SAFETY') {
				const safetyRatings = candidate.safetyRatings?.map(r => `${r.category}: ${r.probability}`).join(', ')
				throw new Error(`Content blocked due to safety concerns (${safetyRatings || 'No details'}).`)
			}
			if (finishReason === 'MAX_TOKENS') {
				console.warn('Summarize with AI: Summary may be incomplete because the max token limit was reached.')
			}

			// Verificação robusta: garante que parts existe e tem conteúdo
			if (candidate?.content?.parts?.length > 0 && candidate.content.parts[0].text) {
				summary = candidate.content.parts[0].text
			} else if (finishReason !== 'STOP' && finishReason !== 'SAFETY') {
				// Se não parou normalmente ou por segurança, e não encontramos texto, loga aviso
				console.warn('Summarize with AI: Gemini response structure missing expected text content.', candidate)
			}
			// Se summary ainda estiver vazio aqui, o erro "did not contain valid summary" será lançado abaixo
		}

		// Verifica se o sumário foi realmente obtido
		if (!summary && !data?.error) { // Adicionada verificação !data?.error para não sobrescrever erros de API
			console.warn('API Response Data:', data) // Loga a resposta para depuração
			throw new Error('API response did not contain a valid summary.')
		}

		// Atualiza o overlay com o sumário formatado
		updateSummaryOverlay(summary)
	}

	/**
	 * Constrói o corpo (payload) da requisição para a API (OpenAI ou Gemini).
	 * Usa parâmetros definidos no modelConfig ou os padrões do serviço.
	 * @param {string} service - 'openai' ou 'gemini'.
	 * @param {object} payload - Objeto com { title, content, lang }.
	 * @param {object} modelConfig - Configuração do modelo ativo { id, service, name?, params? }.
	 * @returns {object} - O objeto do corpo da requisição.
	 */
	function buildRequestBody(service, {title, content, lang}, modelConfig) {
		const systemPrompt        = PROMPT_TEMPLATE(title, content, lang) // Gera o prompt principal
		const serviceDefaults     = MODEL_GROUPS[service]?.defaultParams || {}
		const modelSpecificParams = modelConfig?.params || {}

		if (service === 'openai') {
			// Mescla parâmetros padrão e específicos do modelo
			const finalParams = {...serviceDefaults, ...modelSpecificParams}

			return {
				model:    modelConfig.id, // Usa o ID do modelo da config
				messages: [
					{role: 'system', content: systemPrompt},
					{role: 'user', content: 'Generate the summary as requested.'},
				],
				// Inclui parâmetros mesclados (ex: max_completion_tokens)
				...finalParams
				// 'temperature' não está definido, usará o padrão da API ou o definido em params
			}
		} else { // gemini
			// Mescla parâmetros padrão e específicos do modelo para generationConfig
			const finalGenConfigParams = {...serviceDefaults, ...modelSpecificParams}

			return {
				contents: [{
					parts: [{text: systemPrompt}], // Estrutura do Gemini
				}],
				// Inclui generationConfig com parâmetros mesclados
				generationConfig: finalGenConfigParams
				// 'temperature' não está definido, usará o padrão da API ou o definido em params
			}
		}
	}

	/**
	 * Retorna os cabeçalhos HTTP apropriados para a API.
	 * @param {string} service - 'openai' ou 'gemini'.
	 * @param {string} apiKey - A chave da API.
	 * @returns {object} - O objeto de cabeçalhos.
	 */
	function getHeaders(service, apiKey) {
		const headers = {'Content-Type': 'application/json'}
		if (service === 'openai') {
			headers['Authorization'] = `Bearer ${apiKey}` // OpenAI usa Bearer token
		}
		// Gemini usa a chave na URL, não no cabeçalho
		return headers
	}

	/**
	 * Determina qual serviço ('openai' ou 'gemini') corresponde ao `activeModel` (ID) atual.
	 * Deprecado em favor de getActiveModelConfig() que retorna mais informações.
	 * @returns {string|undefined} - O nome do serviço ou undefined se não encontrado.
	 */
	// function getCurrentService() {
	//     const config = getActiveModelConfig()
	//     return config?.service
	// }

	/**
	 * Obtém a chave da API para o serviço especificado a partir do armazenamento (GM.getValue).
	 * Se não existir, pede ao usuário via prompt e armazena (GM.setValue).
	 * @param {string} service - 'openai' ou 'gemini'.
	 * @returns {Promise<string|null>} - A chave da API ou null se não for fornecida.
	 */
	async function getApiKey(service) {
		const storageKey = `${service}_api_key`
		let apiKey       = await GM.getValue(storageKey)

		if (!apiKey) {
			apiKey = prompt(`Enter your ${service.toUpperCase()} API key:`)
			if (apiKey) {
				apiKey = apiKey.trim()
				await GM.setValue(storageKey, apiKey) // Salva a chave fornecida
			} else {
				return null // Usuário cancelou ou não inseriu
			}
		}
		return apiKey?.trim() // Retorna a chave existente ou recém-inserida
	}

	/**
	 * Permite ao usuário resetar (redefinir) a chave da API via prompt.
	 * Ativado por duplo clique no botão 'S'.
	 */
	async function handleApiKeyReset() {
		const serviceInput = prompt('Reset API key for which service? (openai / gemini)')?.toLowerCase()?.trim()

		if (serviceInput && MODEL_GROUPS[serviceInput]) {
			const storageKey = `${serviceInput}_api_key`
			const newKey     = prompt(`Enter the new ${serviceInput.toUpperCase()} API key (leave blank to clear):`)
			if (newKey !== null) { // Verifica se o usuário não cancelou
				await GM.setValue(storageKey, newKey.trim())
				alert(`${serviceInput.toUpperCase()} API key updated!`)
			}
		} else if (serviceInput) {
			alert('Invalid service name. Please enter "openai" or "gemini".')
		}
	}

	/**
	 * Gerencia o fluxo para adicionar um novo modelo customizado.
	 * Pede ao usuário o serviço e o ID do modelo via prompts.
	 * Salva no formato { id, service }.
	 */
	async function handleAddModel() {
		// 1. Pergunta o serviço (OpenAI ou Gemini)
		const service = prompt('Enter the service for the custom model (openai / gemini):')?.toLowerCase()?.trim()
		if (!service || !MODEL_GROUPS[service]) {
			if (service !== null) alert('Invalid service. Please enter "openai" or "gemini".')
			return // Cancela se inválido ou se o usuário cancelar
		}

		// 2. Pergunta o nome exato (ID) do modelo
		const modelId = prompt(`Enter the exact ID of the ${service.toUpperCase()} model:`)?.trim()
		if (!modelId) {
			if (modelId !== null) alert('Model ID cannot be empty.')
			return // Cancela se vazio ou se o usuário cancelar
		}

		// 3. Adiciona o modelo e salva
		await addCustomModel(service, modelId)
	}

	/**
	 * Adiciona um novo modelo customizado à lista e salva no GM storage.
	 * Atualiza a variável global `customModels`. Salva como { id, service }.
	 * @param {string} service - 'openai' ou 'gemini'.
	 * @param {string} modelId - O ID exato do modelo.
	 */
	async function addCustomModel(service, modelId) {
		// Verifica se o ID do modelo já existe para este serviço
		const exists = customModels.some(m => m.service === service && m.id.toLowerCase() === modelId.toLowerCase())
		if (exists) {
			alert(`Model ID "${modelId}" already exists for ${service.toUpperCase()}.`)
			return
		}

		// Adiciona o novo modelo à lista na memória
		customModels.push({id: modelId, service}) // Salva no formato { id, service }
		// Salva a lista atualizada no storage
		await GM.setValue(CUSTOM_MODELS_KEY, JSON.stringify(customModels))
		alert(`Custom model "${modelId}" (${service.toUpperCase()}) added!`)
	}

	/**
	 * Carrega a lista de modelos customizados salvos no GM storage.
	 * Espera o formato [{ id, service }, ...].
	 * @returns {Promise<Array<object>>} - Uma promessa que resolve com o array de modelos customizados.
	 */
	async function getCustomModels() {
		try {
			const storedModels = await GM.getValue(CUSTOM_MODELS_KEY, '[]') // Obtém a string JSON, default '[]'
			const parsedModels = JSON.parse(storedModels)
			// Validação simples para garantir que é um array de objetos com id e service
			if (Array.isArray(parsedModels) && parsedModels.every(m => typeof m === 'object' && m.id && m.service)) {
				return parsedModels
			} else {
				console.warn("Summarize with AI: Invalid custom model format found in storage. Resetting.", parsedModels)
				await GM.setValue(CUSTOM_MODELS_KEY, '[]') // Reseta se formato inválido
				return []
			}
		} catch (error) {
			console.error('Summarize with AI: Failed to load/parse custom models:', error)
			// Em caso de erro de parse, retorna um array vazio e tenta limpar o storage
			await GM.setValue(CUSTOM_MODELS_KEY, '[]') // Reseta para um array vazio
			return []
		}
	}

	// --- Funções de Eventos e Utilidades ---

	/**
	 * Manipulador para o atalho de teclado (Alt+S) e tecla Esc.
	 * Alt+S: Simula clique no botão 'S' (abre/fecha dropdown).
	 * Esc: Fecha o overlay ou o dropdown.
	 * @param {KeyboardEvent} e - O objeto do evento de teclado.
	 */
	function handleKeyPress(e) {
		// Atalho Alt+S para abrir/fechar dropdown
		if (e.altKey && e.code === 'KeyS') {
			e.preventDefault()
			const button = document.getElementById(BUTTON_ID)
			if (button) {
				toggleDropdown() // Chama a função que alterna a visibilidade do dropdown
			}
		}
		// Tecla Esc para fechar overlay ou dropdown
		if (e.key === 'Escape') {
			if (document.getElementById(OVERLAY_ID)) { // Prioriza fechar o overlay
				closeOverlay()
			} else if (document.getElementById(DROPDOWN_ID)?.style.display !== 'none') { // Fecha o dropdown se aberto
				hideElement(DROPDOWN_ID)
			}
		}
	}

	/**
	 * Configura listeners para esconder/mostrar o botão 'S' com base no foco em inputs.
	 */
	function setupFocusListeners() {
		// Esconde o botão quando um campo editável ganha foco
		document.addEventListener('focusin', (event) => {
			if (event.target?.closest('input, textarea, select, [contenteditable="true"]')) {
				hideElement(BUTTON_ID)
				hideElement(DROPDOWN_ID) // Esconde dropdown também
			}
		})

		// Mostra o botão quando o foco sai de um campo editável (clicando fora)
		document.addEventListener('focusout', (event) => {
			// Verifica se o elemento que perdeu o foco é um campo editável
			// e se o novo elemento focado (relatedTarget) NÃO é um campo editável
			const isLeavingInput  = event.target?.closest('input, textarea, select, [contenteditable="true"]')
			const isEnteringInput = event.relatedTarget?.closest('input, textarea, select, [contenteditable="true"]')

			// Só mostra o botão se estiver saindo de um input e não entrando em outro,
			// e se o artigo foi detectado.
			if (isLeavingInput && !isEnteringInput && articleData) {
				// Pequeno delay para evitar piscar se o foco mudar rapidamente entre inputs
				setTimeout(() => {
					// Reconfirma se o foco atual não é um input antes de mostrar
					if (!document.activeElement?.closest('input, textarea, select, [contenteditable="true"]')) {
						showElement(BUTTON_ID)
					}
				}, 50) // Delay de 50ms
			}
		}, true) // Usa captura para garantir que o evento seja pego
	}

	/**
	 * Injeta os estilos CSS necessários para a interface do script.
	 */
	function injectStyles() {
		// Estilos CSS mantidos
		GM.addStyle(`
      #${BUTTON_ID} {
        position: fixed; bottom: 20px; right: 20px;
        width: 50px; height: 50px; /* Tamanho */
        background: linear-gradient(145deg, #3a7bd5, #00d2ff); /* Gradiente azul */
        color: white; font-size: 24px; /* Texto */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        border-radius: 50%; cursor: pointer; z-index: 2147483640;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        display: flex !important; align-items: center !important; justify-content: center !important; /* Centraliza 'S' */
        transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
        line-height: 1; user-select: none; /* Previne seleção */
      }
      #${BUTTON_ID}:hover {
        transform: scale(1.1); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
      }
      #${DROPDOWN_ID} {
        position: fixed; bottom: 80px; right: 20px; /* Acima do botão */
        background: #ffffff; border: 1px solid #e0e0e0; border-radius: 10px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15); z-index: 2147483641; /* Acima do botão */
        max-height: 70vh; overflow-y: auto; /* Scroll */
        padding: 8px; width: 300px; /* Dimensões */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        display: none; /* Começa oculto */
        animation: fadeIn 0.2s ease-out; /* Animação */
      }
      .model-group { margin-bottom: 8px; }
      .group-header {
        padding: 8px 12px; font-weight: 600; color: #333; background: #f7f7f7;
        border-radius: 6px; margin-bottom: 4px; font-size: 13px;
        text-transform: uppercase; letter-spacing: 0.5px;
      }
      .model-item {
        padding: 10px 14px; margin: 2px 0; border-radius: 6px;
        transition: background-color 0.15s ease-out, color 0.15s ease-out;
        font-size: 14px; cursor: pointer; color: #444; display: block;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; /* Evita quebra de linha em nomes longos */
      }
      .model-item:hover { background-color: #eef6ff; color: #1a73e8; }
      .add-model-item { /* Estilo específico para o item de adicionar modelo */
         color: #666;
         font-style: italic;
      }
      .add-model-item:hover { background-color: #f0f0f0; color: #333; }
      #${OVERLAY_ID} {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(0, 0, 0, 0.6); /* Fundo semi-transparente */
        z-index: 2147483645; /* Muito alto */
        display: flex; align-items: center; justify-content: center;
        overflow: hidden; /* Impede scroll do body */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        animation: fadeIn 0.3s ease-out;
      }
      #${CONTENT_ID} {
        background-color: #fff; padding: 25px 35px; border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        max-width: 800px; width: 90%; max-height: 85vh; /* Dimensões */
        overflow-y: auto; /* Scroll interno */
        position: relative; font-size: 16px; line-height: 1.6; color: #333;
        animation: slideInUp 0.3s ease-out; /* Animação */
        white-space: pre-wrap; /* Preserva quebras de linha e espaços do sumário */
      }
      #${CONTENT_ID} ul { margin: 1em 0; padding-left: 0; } /* Ajuste para remover padding padrão */
      #${CONTENT_ID} li { list-style-type: none; margin-bottom: 0.5em; } /* Remove bullet padrão e adiciona margem */
       #${CONTENT_ID} p { margin-top: 0; margin-bottom: 1em; } /* Margem padrão para parágrafos */
      #${CLOSE_BUTTON_ID} {
        position: absolute; top: 10px; right: 15px;
        font-size: 28px; color: #aaa; cursor: pointer;
        transition: color 0.2s; line-height: 1;
      }
      #${CLOSE_BUTTON_ID}:hover { color: #333; }
      #${ERROR_ID} {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); /* Centralizado */
        background-color: #e53e3e; color: white; padding: 12px 20px;
        border-radius: 6px; z-index: 2147483646; /* Acima de tudo */
        font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        animation: fadeIn 0.3s, fadeOut 0.3s 3.7s forwards; /* Fade in e out */
      }
      .glow { /* Estilo para "Summarizing..." */
        font-size: 1.4em; color: #555; text-align: center; padding: 40px 0;
        animation: glow 1.8s ease-in-out infinite alternate;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-weight: 300;
      }

      /* Animações */
      @keyframes glow {
        from { color: #4a90e2; text-shadow: 0 0 8px rgba(74, 144, 226, 0.5); }
        to { color: #7aa7d6; text-shadow: 0 0 15px rgba(122, 167, 214, 0.7); }
      }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
      @keyframes slideInUp {
         from { transform: translateY(30px); opacity: 0; }
         to { transform: translateY(0); opacity: 1; }
      }
    `)
	}

	// --- Inicialização ---
	initialize() // Chama a função principal para iniciar o script

})()
