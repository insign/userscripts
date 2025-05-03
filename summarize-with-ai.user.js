// ==UserScript==
// @name         Summarize with AI
// @namespace    https://github.com/insign/userscripts
// @version      2025.05.03.1759
// @description  Single-button AI summarization (OpenAI/Gemini) with model selection dropdown for articles/news. Uses Alt+S shortcut. Long press 'S' to select model. Allows adding custom models. Adapts summary overlay to system dark mode.
// @author       Hélio <open@helio.me>
// @license      WTFPL
// @match        *://*/*
// @grant        GM.addStyle
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @connect      api.openai.com
// @connect      generativelanguage.googleapis.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/readability/0.6.0/Readability.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/readability/0.6.0/Readability-readerable.min.js
// @downloadURL  https://update.greasyfork.org/scripts/509192/Summarize%20with%20AI.user.js
// @updateURL    https://update.greasyfork.org/scripts/509192/Summarize%20with%20AI.meta.js
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
	const RETRY_BUTTON_ID = 'summarize-retry-button' // ID para o botão "Tentar Novamente" no overlay de erro

	// Chave para armazenar modelos customizados no GM storage
	const CUSTOM_MODELS_KEY = 'custom_ai_models'

	// Limite de tokens padrão
	const DEFAULT_MAX_TOKENS = 1000
	// Limite de tokens alto (para modelos específicos)
	const HIGH_MAX_TOKENS    = 1500
	// Tempo para considerar long press (em milissegundos)
	const LONG_PRESS_DURATION = 500

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
	// Instruções atualizadas para usar as classes CSS específicas de qualidade
	const PROMPT_TEMPLATE = (title, content, lang) => `You are a summarizer bot that provides clear and affirmative explanations of content.
		Generate a concise summary that includes:
		- 2-sentence introduction
- Relevant emojis as bullet points
- No section headers
- Use HTML formatting, never use \`\`\` code blocks, never use markdown.
- After the last bullet point add a 2-sentence conclusion with your own opinion based on your general knowledge, including if you agree or disagree and why. Give your opinion as a human. Start this conclusion with "<strong>Opinion:</strong> ". Do not add things like "I agree" or "I disagree", instead just your opinion.
- User language to be used in the entire summary: ${lang}
- Before everything, add quality of the article, like "<strong>Article Quality:</strong> <span class=article-good>8/10</span>", where 1 is bad and 10 is excellent.
- For the quality class use:
	<span class=article-excellent>9/10</span> (or 10)
	<span class=article-good>8/10</span>
	<span class=article-average>7/10</span>
	<span class=article-bad>6/10</span>
	<span class=article-very-bad>5/10</span> (or less)
- "Opinion:", "Article Quality:" should be in user language, e.g. "Opinião:", "Qualidade do artigo:" for Português.

Article Title: ${title}
Article Content: ${content}`

// --- Variáveis de Estado ---
	let activeModel    = 'gemini-2.5-flash-preview-04-17' // ID do modelo ativo selecionado por padrão ou pelo usuário
	let articleData    = null                             // Armazena o título e conteúdo extraído do artigo { title, content }
	let customModels   = []                              // Array para armazenar modelos customizados carregados do storage { id, service }
	let longPressTimer = null                             // Timer para detectar long press no botão 'S'
	let isLongPress    = false                            // Flag para indicar se ocorreu long press

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
			const reader  = new Readability(docClone)
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
	 * Configura os event listeners do botão (click, long press) e injeta estilos.
	 */
	function addSummarizeButton() {
		// Evita adicionar o botão múltiplas vezes
		if (document.getElementById(BUTTON_ID)) return

		// Cria o botão 'S'
		const button       = document.createElement('div')
		button.id          = BUTTON_ID
		button.textContent = 'S' // Texto simples e pequeno
		button.title = 'Summarize (Alt+S) / Long Press to Select Model' // Tooltip atualizado (sem dblclick)
		document.body.appendChild(button)

		// Cria o dropdown (inicialmente oculto)
		const dropdown = createDropdownElement() // Cria o elemento base do dropdown
		document.body.appendChild(dropdown)
		populateDropdown(dropdown) // Preenche o dropdown com modelos

		// Listener para clique simples: Inicia a sumarização com o modelo ativo
		button.addEventListener('click', () => {
			// Só executa se não foi um long press
			if (!isLongPress) {
				processSummarization() // Chama a função principal de sumarização
			}
			// Reseta a flag de long press para o próximo clique
			isLongPress = false
		})

		// Listener para Long Press: Mostra/esconde o dropdown
		button.addEventListener('mousedown', (e) => {
			// Inicia o timer para detectar long press
			isLongPress = false // Reseta a flag
			clearTimeout(longPressTimer) // Limpa timer anterior se houver
			longPressTimer = setTimeout(() => {
				isLongPress = true // Marca que ocorreu long press
				toggleDropdown(e) // Abre/fecha o dropdown
			}, LONG_PRESS_DURATION)
		})

		// Listener para soltar o botão (cancela o timer se antes do tempo)
		button.addEventListener('mouseup', () => {
			clearTimeout(longPressTimer)
		})

		// Listener se o mouse sair do botão (cancela o timer)
		button.addEventListener('mouseleave', () => {
			clearTimeout(longPressTimer)
		})

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
	 * e a opção para adicionar novos modelos. Adiciona links de reset de API Key.
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
				// Cria o cabeçalho com link de reset
				groupDiv.appendChild(createHeader(group.name, service))
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
	 * Cria um elemento de cabeçalho para um grupo de modelos no dropdown,
	 * incluindo um link para resetar a API Key do serviço.
	 * @param {string} text - O texto do cabeçalho (nome do serviço).
	 * @param {string} service - A chave do serviço ('openai' ou 'gemini').
	 * @returns {HTMLElement} - O elemento div do cabeçalho.
	 */
	function createHeader(text, service) {
		const headerContainer     = document.createElement('div')
		headerContainer.className = 'group-header-container' // Container para flex layout

		const headerText       = document.createElement('span') // Span para o texto
		headerText.className   = 'group-header-text'
		headerText.textContent = text

		const resetLink       = document.createElement('a') // Link para resetar
		resetLink.href        = '#'
		resetLink.textContent = 'Reset Key'
		resetLink.className   = 'reset-key-link'
		resetLink.title       = `Reset ${text} API Key`
		resetLink.addEventListener('click', (e) => {
			e.preventDefault() // Previne navegação
			e.stopPropagation() // Impede que feche o dropdown
			handleApiKeyReset(service) // Chama o reset para o serviço específico
		})

		headerContainer.appendChild(headerText)
		headerContainer.appendChild(resetLink)
		return headerContainer
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
		item.addEventListener('click', async (e) => {
			e.stopPropagation() // Impede que feche o dropdown
			hideElement(DROPDOWN_ID) // Esconde o dropdown antes de mostrar os prompts
			await handleAddModel()
		})
		return item
	}

	/**
	 * Mostra ou esconde o dropdown de seleção de modelo.
	 * @param {Event} [e] - O objeto do evento de clique/mousedown (opcional, para stopPropagation).
	 */
	function toggleDropdown(e) {
		if (e) e.stopPropagation() // Impede que o clique feche imediatamente o dropdown
		const dropdown = document.getElementById(DROPDOWN_ID)
		if (dropdown) {
			const isHidden = dropdown.style.display === 'none'
			if (isHidden) {
				// Repopula o dropdown caso modelos tenham sido adicionados/removidos ou para atualizar link de reset
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
				!button?.contains(event.target)) { // Verifica se o botão existe
			hideElement(DROPDOWN_ID)
		}
	}

	/**
	 * Exibe o overlay de sumarização com o conteúdo fornecido.
	 * Cria o overlay se ele não existir.
	 * Simplificado: O botão retry apenas chama processSummarization.
	 * @param {string} contentHTML - O conteúdo HTML a ser exibido (pode ser loading, sumário ou erro com retry).
	 * @param {boolean} [isError=false] - Indica se o conteúdo é uma mensagem de erro para adicionar botão de retry.
	 */
	function showSummaryOverlay(contentHTML, isError = false) {
		// Se o overlay já existe, apenas atualiza o conteúdo
		if (document.getElementById(OVERLAY_ID)) {
			updateSummaryOverlay(contentHTML, isError)
			return
		}

		// Cria o elemento do overlay
		const overlay    = document.createElement('div')
		overlay.id       = OVERLAY_ID
		// Define o HTML interno com container, botão de fechar e conteúdo inicial
		let finalContent = `<div id="${CLOSE_BUTTON_ID}" title="Close (Esc)">×</div>${contentHTML}`
		// Adiciona botão de Tentar Novamente se for um erro
		if (isError) {
			finalContent += `<button id="${RETRY_BUTTON_ID}" class="retry-button">Try Again</button>`
		}
		overlay.innerHTML = `<div id="${CONTENT_ID}">${finalContent}</div>`

		document.body.appendChild(overlay)
		document.body.style.overflow = 'hidden' // Trava o scroll do body

		// Adiciona listeners para fechar o overlay
		document.getElementById(CLOSE_BUTTON_ID).addEventListener('click', closeOverlay)
		overlay.addEventListener('click', (e) => { // Fecha clicando no fundo (fora do content)
			if (e.target === overlay) closeOverlay()
		})
		// Adiciona listener para o botão de Tentar Novamente, se existir
		// Apenas chama processSummarization() novamente
		document.getElementById(RETRY_BUTTON_ID)?.addEventListener('click', processSummarization)
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
	 * Simplificado: O botão retry apenas chama processSummarization.
	 * @param {string} contentHTML - O novo conteúdo HTML.
	 * @param {boolean} [isError=false] - Indica se o conteúdo é uma mensagem de erro para adicionar botão de retry.
	 */
	function updateSummaryOverlay(contentHTML, isError = false) {
		const contentDiv = document.getElementById(CONTENT_ID)
		if (contentDiv) {
			// Recria o conteúdo interno, garantindo que o botão de fechar permaneça
			let finalContent = `<div id="${CLOSE_BUTTON_ID}" title="Close (Esc)">×</div>${contentHTML}`
			// Adiciona botão de Tentar Novamente se for um erro
			if (isError) {
				finalContent += `<button id="${RETRY_BUTTON_ID}" class="retry-button">Try Again</button>`
			}
			contentDiv.innerHTML = finalContent
			// Reatribui o listener ao novo botão de fechar
			document.getElementById(CLOSE_BUTTON_ID)?.addEventListener('click', closeOverlay)
			// Reatribui listener ao botão de Tentar Novamente, se existir
			// Apenas chama processSummarization() novamente
			document.getElementById(RETRY_BUTTON_ID)?.addEventListener('click', processSummarization)
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
				// Retorna uma cópia do objeto, adicionando a chave do serviço
				return {...modelConfig, service: service}
			}
		}
		// Verifica modelos customizados
		const customConfig = customModels.find(m => m.id === activeModel)
		if (customConfig) {
			// Custom models não tem 'name' ou 'params' definidos por padrão aqui
			// Retorna uma cópia do objeto customizado { id, service }
			return {...customConfig}
		}
		console.error(`Summarize with AI: Active model configuration not found for ID: ${activeModel}`)
		return null // Modelo não encontrado
	}

	/**
	 * Orquestra o processo de sumarização: obtém API key, mostra overlay de loading com nome do modelo,
	 * envia requisição à API e trata a resposta.
	 */
	async function processSummarization() {
		try {
			// Garante que temos dados do artigo antes de prosseguir
			if (!articleData) {
				showErrorNotification('Article content not found or not readable.')
				return
			}

			const modelConfig = getActiveModelConfig() // Obtém a configuração completa do modelo ativo
			if (!modelConfig) {
				// Mensagem de erro mais informativa se o modelo não for encontrado
				showErrorNotification(`Configuration for model "${activeModel}" not found. Please select another model.`)
				return // Interrompe a execução se a configuração não for encontrada
			}

			// Determina o nome a ser exibido (usa 'name' se disponível, senão 'id')
			const modelDisplayName = modelConfig.name || modelConfig.id
			const service          = modelConfig.service // Determina 'openai' ou 'gemini' a partir da config

			const apiKey = await getApiKey(service) // Obtém a API key (pede ao usuário se não tiver)
			if (!apiKey) { // Aborta se não houver API key
				// Mostra erro no overlay se estiver aberto, senão como notificação
				const errorMsg = `API key for ${service.toUpperCase()} is required. Click the 'Reset Key' link in the model selection menu (long-press 'S' button).`
				if (document.getElementById(OVERLAY_ID)) {
					// Mostra o erro no overlay existente, sem botão de retry para este caso
					updateSummaryOverlay(`<p style="color: red;">${errorMsg}</p>`, false)
				} else {
					// Se o overlay não estava aberto, mostra como notificação
					showErrorNotification(errorMsg)
				}
				return // Interrompe se não houver chave
			}

			// Mostra feedback de loading com o nome do modelo
			// Verifica se o overlay já existe (caso seja um retry)
			const loadingMessage = `<p class="glow">Summarizing with ${modelDisplayName}... </p>`
			if (document.getElementById(OVERLAY_ID)) {
				updateSummaryOverlay(loadingMessage) // Atualiza overlay existente
			} else {
				showSummaryOverlay(loadingMessage) // Cria novo overlay
			}

			// Prepara os dados para a API
			const payload = {title: articleData.title, content: articleData.content, lang: navigator.language || 'en-US'}

			// Passa a configuração do modelo para sendApiRequest
			const response = await sendApiRequest(service, apiKey, payload, modelConfig)

			handleApiResponse(response, service) // Processa a resposta

		} catch (error) {
			// Exibe erros no overlay com botão de Tentar Novamente
			const errorMsg = `Error: ${error.message}`
			console.error('Summarize with AI:', errorMsg, error) // Loga o erro completo
			// Mostra erro no overlay (ou cria um novo se não existir), com botão de retry
			showSummaryOverlay(`<p style="color: red;">${errorMsg}</p>`, true)
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
						status: response.status,
						// Tenta parsear mesmo que responseType seja json, pois pode falhar
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
	 * Processa a resposta da API, extrai o sumário, limpa quebras de linha extras e atualiza o overlay.
	 * @param {object} response - O objeto de resposta resolvido da Promise de `sendApiRequest` (contém status, data).
	 * @param {string} service - 'openai' ou 'gemini'.
	 */
	function handleApiResponse(response, service) {
		const {status, data, statusText} = response

		// Verifica se o status HTTP indica sucesso (2xx)
		if (status < 200 || status >= 300) {
			// Tenta extrair uma mensagem de erro mais detalhada do corpo da resposta
			const errorDetails = data?.error?.message || data?.message || statusText || 'Unknown API error' // Gemini pode usar 'message' no erro
			throw new Error(`API Error (${status}): ${errorDetails}`)
		}

		// Extrai o conteúdo do sumário dependendo do serviço
		let rawSummary = ''
		if (service === 'openai') {
			const choice = data?.choices?.[0]
			rawSummary   = choice?.message?.content

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
				rawSummary = candidate.content.parts[0].text
			} else if (finishReason && !['STOP', 'SAFETY', 'MAX_TOKENS'].includes(finishReason)) {
				// Loga aviso se motivo de finalização não for comum e não houver texto
				console.warn(`Summarize with AI: Gemini response structure missing expected text content or unusual finish reason: ${finishReason}`, candidate)
			} else if (!rawSummary && !data?.error) {
				console.warn('Summarize with AI: Gemini response structure missing expected text content.', candidate)
			}
			// Se rawSummary ainda estiver vazio aqui, o erro "did not contain valid summary" será lançado abaixo
		}

		// Verifica se o sumário foi realmente obtido
		if (!rawSummary && !data?.error) { // Adicionada verificação !data?.error para não sobrescrever erros de API
			console.error('Summarize with AI: API Response Data:', data) // Loga a resposta para depuração
			throw new Error('API response did not contain a valid summary.')
		}

		// Limpa quebras de linha (\n) que não fazem parte de tags HTML (substitui por espaço)
		// e comprime múltiplos espaços em um único espaço.
		// Isso ajuda a evitar espaçamento duplo estranho se a API retornar \n desnecessários.
		const cleanedSummary = rawSummary.replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim()

		// Atualiza o overlay com o sumário limpo, sem botão de retry
		updateSummaryOverlay(cleanedSummary, false)
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
	 * Obtém a chave da API para o serviço especificado a partir do armazenamento (GM.getValue).
	 * Se não existir, retorna null (a verificação e mensagem de erro ocorrem em processSummarization).
	 * @param {string} service - 'openai' ou 'gemini'.
	 * @returns {Promise<string|null>} - A chave da API ou null se não for encontrada.
	 */
	async function getApiKey(service) {
		const storageKey = `${service}_api_key`
		let apiKey       = await GM.getValue(storageKey)
		// Retorna a chave encontrada ou null se não existir/vazia
		return apiKey?.trim() || null
	}

	/**
	 * Permite ao usuário resetar (redefinir) a chave da API para um serviço específico via prompt.
	 * Ativado pelo link 'Reset Key' no dropdown.
	 * @param {string} service - O serviço ('openai' ou 'gemini') para o qual resetar a chave.
	 */
	async function handleApiKeyReset(service) {
		if (!service || !MODEL_GROUPS[service]) {
			console.error("Invalid service provided for API key reset:", service)
			alert("Internal error: Invalid service provided.")
			return
		}

		const storageKey = `${service}_api_key`
		const newKey     = prompt(`Enter the new ${service.toUpperCase()} API key (leave blank to clear):`)

		if (newKey !== null) { // Verifica se o usuário não cancelou (clicou em OK ou deixou em branco)
			const keyToSave = newKey.trim()
			await GM.setValue(storageKey, keyToSave)
			if (keyToSave) {
				alert(`${service.toUpperCase()} API key updated!`)
			} else {
				alert(`${service.toUpperCase()} API key cleared!`)
			}
			// Opcional: Repopular dropdown para refletir alguma mudança visual se necessário
			// const dropdown = document.getElementById(DROPDOWN_ID)
			// if (dropdown && dropdown.style.display !== 'none') {
			//     populateDropdown(dropdown)
			// }
		}
		// Se newKey for null (usuário clicou Cancelar), não faz nada.
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
		// Opcional: reabrir dropdown após adicionar? Por ora, não.
	}

	/**
	 * Adiciona um novo modelo customizado à lista e salva no GM storage.
	 * Atualiza a variável global `customModels`. Salva como { id, service }.
	 * @param {string} service - 'openai' ou 'gemini'.
	 * @param {string} modelId - O ID exato do modelo.
	 */
	async function addCustomModel(service, modelId) {
		// Verifica se o ID do modelo já existe para este serviço (case-insensitive)
		const exists = customModels.some(m => m.service === service && m.id.toLowerCase() === modelId.toLowerCase()) ||
				MODEL_GROUPS[service]?.models.some(m => m.id.toLowerCase() === modelId.toLowerCase()) // Verifica também nos padrões

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
	 * Alt+S: Simula clique no botão 'S' (inicia sumarização).
	 * Esc: Fecha o overlay ou o dropdown.
	 * @param {KeyboardEvent} e - O objeto do evento de teclado.
	 */
	function handleKeyPress(e) {
		// Atalho Alt+S para iniciar sumarização (simula clique simples)
		if (e.altKey && e.code === 'KeyS') {
			e.preventDefault()
			const button = document.getElementById(BUTTON_ID)
			if (button) {
				// Chama a função principal de sumarização
				processSummarization()
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
		// Estilos CSS com adições para cores de qualidade e dark mode
		GM.addStyle(`
      /* --- Elementos Principais da UI --- */
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
      #${OVERLAY_ID} {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(0, 0, 0, 0.6); /* Fundo semi-transparente (padrão light) */
        z-index: 2147483645; /* Muito alto */
        display: flex; align-items: center; justify-content: center;
        overflow: hidden; /* Impede scroll do body */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        animation: fadeIn 0.3s ease-out;
      }
      #${CONTENT_ID} {
        background-color: #fff; /* Fundo branco (padrão light) */
        color: #333; /* Texto escuro (padrão light) */
        padding: 25px 35px; border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        max-width: 800px; width: 90%; max-height: 85vh; /* Dimensões */
        overflow-y: auto; /* Scroll interno */
        position: relative; font-size: 16px; line-height: 1.6;
        animation: slideInUp 0.3s ease-out; /* Animação */
        white-space: normal; /* Permite quebra de linha HTML */
      }
      #${CONTENT_ID} p { margin-top: 0; margin-bottom: 1em; } /* Margem padrão para parágrafos */
      #${CONTENT_ID} ul { margin: 1em 0; padding-left: 1.5em; } /* Adiciona padding para bullet points */
      #${CONTENT_ID} li { list-style-type: none; margin-bottom: 0.5em; } /* Remove marcador padrão (usa emoji) */
      #${CLOSE_BUTTON_ID} {
        position: absolute; top: 10px; right: 15px;
        font-size: 28px; color: #aaa; /* Cinza claro (padrão light) */
        cursor: pointer;
        transition: color 0.2s; line-height: 1; z-index: 1; /* Garante que fique acima do conteúdo */
      }
      #${CLOSE_BUTTON_ID}:hover { color: #333; } /* Mais escuro no hover (light) */
      #${ERROR_ID} {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); /* Centralizado */
        background-color: #e53e3e; color: white; padding: 12px 20px;
        border-radius: 6px; z-index: 2147483646; /* Acima de tudo */
        font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        animation: fadeIn 0.3s, fadeOut 0.3s 3.7s forwards; /* Fade in e out */
      }
      .retry-button { /* Estilo para o botão Tentar Novamente */
        display: block; margin: 20px auto 0; padding: 8px 16px;
        background-color: #4a90e2; /* Azul (padrão light) */
        color: white; border: none; border-radius: 5px;
        cursor: pointer; font-size: 14px; transition: background-color 0.2s;
      }
      .retry-button:hover { background-color: #3a7bd5; } /* Azul mais escuro no hover (light) */

      /* --- Estilos do Dropdown --- */
      .model-group { margin-bottom: 8px; }
      .group-header-container { /* Container para header e link reset */
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; background: #f7f7f7;
        border-radius: 6px; margin-bottom: 4px;
      }
      .group-header-text { /* Texto do header */
        font-weight: 600; color: #333; font-size: 13px;
        text-transform: uppercase; letter-spacing: 0.5px;
        flex-grow: 1; /* Ocupa espaço disponível */
      }
      .reset-key-link { /* Link de reset */
        font-size: 11px; color: #666; text-decoration: none;
        margin-left: 10px; /* Espaçamento */
        white-space: nowrap; /* Não quebrar linha */
        cursor: pointer;
        transition: color 0.2s;
      }
      .reset-key-link:hover { color: #1a73e8; }
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

      /* --- Estilos de Conteúdo (Glow, Qualidade) --- */
      .glow { /* Estilo para "Summarizing with [Model]..." / "Retrying with [Model]..." */
        font-size: 1.4em; text-align: center; padding: 40px 0;
        /* Aplica a animação 'glow' com ciclo infinito e duração de 2.5s */
        animation: glow 2.5s ease-in-out infinite;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-weight: 400;
      }
      /* Cores para as classes de qualidade do artigo */
      span.article-excellent { color: #2ecc71; font-weight: bold; } /* Verde brilhante */
      span.article-good      { color: #3498db; font-weight: bold; } /* Azul */
      span.article-average   { color: #f39c12; font-weight: bold; } /* Laranja */
      span.article-bad       { color: #e74c3c; font-weight: bold; } /* Vermelho */
      span.article-very-bad  { color: #c0392b; font-weight: bold; } /* Vermelho escuro */

      /* --- Animações --- */
      /* Define os keyframes para a animação 'glow' ciclando entre azul, roxo e vermelho */
      @keyframes glow {
        0%, 100% { /* Início e Fim: Azul */
          color: #4a90e2;
          text-shadow: 0 0 10px rgba(74, 144, 226, 0.6),
                       0 0 20px rgba(74, 144, 226, 0.4);
        }
        33% { /* Ponto intermediário 1: Roxo */
          color: #9b59b6; /* Tom de roxo */
          text-shadow: 0 0 12px rgba(155, 89, 182, 0.7), /* Sombra roxa */
                       0 0 25px rgba(155, 89, 182, 0.5);
        }
        66% { /* Ponto intermediário 2: Vermelho */
          color: #e74c3c; /* Tom de vermelho */
          text-shadow: 0 0 12px rgba(231, 76, 60, 0.7), /* Sombra vermelha */
                       0 0 25px rgba(231, 76, 60, 0.5);
        }
      }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
      @keyframes slideInUp {
         from { transform: translateY(30px); opacity: 0; }
         to { transform: translateY(0); opacity: 1; }
      }

      /* --- Dark Mode Override (Adaptação automática ao tema escuro do sistema) --- */
      @media (prefers-color-scheme: dark) {
        /* Fundo do overlay mais escuro */
        #${OVERLAY_ID} {
          background-color: rgba(20, 20, 20, 0.7); /* Fundo mais opaco e escuro */
        }
        /* Conteúdo do sumário com fundo escuro e texto claro */
        #${CONTENT_ID} {
          background-color: #2c2c2c; /* Cinza bem escuro */
          color: #e0e0e0; /* Texto cinza claro */
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4); /* Sombra um pouco mais visível */
        }
        /* Botão de fechar com cores invertidas */
        #${CLOSE_BUTTON_ID} {
          color: #888; /* Cinza médio */
        }
        #${CLOSE_BUTTON_ID}:hover {
          color: #eee; /* Quase branco no hover */
        }
        /* Botão Tentar Novamente com estilo adaptado */
        .retry-button {
          background-color: #555; /* Cinza médio */
          color: #eee; /* Texto claro */
        }
        .retry-button:hover {
          background-color: #666; /* Cinza um pouco mais claro no hover */
        }
        /* Dropdown também pode ter fundo escuro (opcional, mantendo legibilidade) */
        #${DROPDOWN_ID} {
           background: #333; /* Fundo escuro para dropdown */
           border-color: #555; /* Borda mais escura */
        }
        .model-item {
           color: #ccc; /* Texto do item mais claro */
        }
        .model-item:hover {
           background-color: #444; /* Fundo de hover mais escuro */
           color: #fff; /* Texto branco no hover */
        }
        .group-header-container {
           background: #444; /* Fundo do cabeçalho do grupo */
        }
        .group-header-text {
           color: #eee; /* Texto do cabeçalho claro */
        }
        .reset-key-link {
           color: #aaa; /* Link de reset mais claro */
        }
        .reset-key-link:hover {
           color: #fff; /* Link de reset branco no hover */
        }
        .add-model-item {
           color: #999; /* Item de adicionar mais claro */
        }
        .add-model-item:hover {
           background-color: #4a4a4a; /* Fundo de hover */
           color: #eee; /* Texto claro no hover */
        }
        hr {
           border-top-color: #555 !important; /* Separador mais escuro */
        }
        /* Ajuste de cor para o brilho no modo escuro se necessário (opcional) */
        /* As cores atuais do glow parecem funcionar bem, mas podem ser ajustadas aqui */
        /* @keyframes glow-dark { ... } */
        /* .glow { animation-name: glow-dark; } */
      }
    `)
	}

// --- Inicialização ---
	initialize() // Chama a função principal para iniciar o script

})()
