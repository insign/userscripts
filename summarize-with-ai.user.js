// ==UserScript==
// @name         Summarize with AI
// @namespace    https://github.com/insign/userscripts
// @version      2025.05.04.1546
// @description  Single-button AI summarization (OpenAI/Gemini) with model selection dropdown for articles/news. Uses Alt+S shortcut. Long press 'S' (or tap-and-hold on mobile) to select model. Allows adding custom models. Adapts summary overlay to system dark mode and mobile viewports.
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
	// Estrutura: models é um array de objetos com id, name (opcional), params (opcional)
	const MODEL_GROUPS = {
		openai: {
			name:    'OpenAI',
			baseUrl: 'https://api.openai.com/v1/chat/completions',
			models:  [
				{id: 'o4-mini', name: 'o4 mini (better)', params: {max_completion_tokens: HIGH_MAX_TOKENS}},
				{id: 'o3-mini', name: 'o3 mini', params: {max_completion_tokens: HIGH_MAX_TOKENS}},
				{id: 'gpt-4.1', name: 'GPT-4.1'}, // Usa params padrão (DEFAULT_MAX_TOKENS)
				{id: 'gpt-4.1-mini', name: 'GPT-4.1 mini'}, // Usa params padrão
				{id: 'gpt-4.1-nano', name: 'GPT-4.1 nano (faster)'}, // Usa params padrão
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
	let longPressTimer = null                             // Timer para detectar long press (ou tap-and-hold) no botão 'S'
	let isLongPress    = false                            // Flag para indicar se ocorreu long press/tap-and-hold

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
			// Remove elementos que podem interferir com a extração (scripts, estilos, imagens, etc.)
			docClone.querySelectorAll('script, style, noscript, iframe, figure, img, svg, header, footer, nav').forEach(el => el.remove())
			// Verifica se a página é provavelmente legível usando a heurística da biblioteca
			if (!isProbablyReaderable(docClone)) {
				console.log('Summarize with AI: Page not detected as readerable.')
				return null // Retorna nulo se não parecer um artigo
			}
			const reader  = new Readability(docClone) // Instancia o Readability
			const article = reader.parse() // Tenta extrair o conteúdo principal
			// Retorna dados se o conteúdo foi extraído e não está vazio/apenas espaços
			return (article?.content && article.textContent?.trim())
					? {title: article.title, content: article.textContent.trim()} // Retorna título e texto limpo
					: null // Retorna nulo se não conseguiu extrair conteúdo de texto
		} catch (error) {
			console.error('Summarize with AI: Article parsing failed:', error)
			return null // Retorna null em caso de erro na extração
		}
	}

	/**
	 * Adiciona o botão flutuante 'S' e o dropdown de seleção de modelo ao DOM.
	 * Configura os event listeners do botão (click, long press, touch) e injeta estilos.
	 */
	function addSummarizeButton() {
		// Evita adicionar o botão múltiplas vezes se o script for executado novamente por algum motivo
		if (document.getElementById(BUTTON_ID)) return

		// Cria o botão 'S'
		const button       = document.createElement('div')
		button.id          = BUTTON_ID
		button.textContent = 'S' // Texto simples e pequeno 'S'
		button.title       = 'Summarize (Alt+S) / Long Press or Tap & Hold to Select Model' // Tooltip atualizado
		document.body.appendChild(button)

		// Cria o dropdown (inicialmente oculto)
		const dropdown = createDropdownElement() // Cria o elemento base do dropdown
		document.body.appendChild(dropdown)
		populateDropdown(dropdown) // Preenche o dropdown com os modelos disponíveis

		// Listener para clique simples (ou tap): Inicia a sumarização com o modelo ativo
		button.addEventListener('click', () => {
			// Só executa a sumarização se *não* foi um long press/tap-and-hold que abriu o menu
			if (!isLongPress) {
				processSummarization() // Chama a função principal de sumarização
			}
			// Reseta a flag de long press para o próximo clique/toque
			isLongPress = false
		})

		// ---- Lógica para Long Press (Mouse) e Tap & Hold (Touch) ----

		// Função para iniciar o timer de long press/tap-and-hold
		const startLongPressTimer = (event) => {
			isLongPress = false // Reseta a flag
			clearTimeout(longPressTimer) // Limpa timer anterior, se houver
			longPressTimer = setTimeout(() => {
				isLongPress = true // Marca que ocorreu long press/tap-and-hold
				toggleDropdown(event) // Abre/fecha o dropdown
			}, LONG_PRESS_DURATION)
		}

		// Função para cancelar o timer
		const cancelLongPressTimer = () => {
			clearTimeout(longPressTimer)
		}

		// Listeners de Mouse
		button.addEventListener('mousedown', startLongPressTimer)
		button.addEventListener('mouseup', cancelLongPressTimer)
		button.addEventListener('mouseleave', cancelLongPressTimer) // Cancela se o mouse sair

		// Listeners de Touch (para dispositivos móveis)
		button.addEventListener('touchstart', startLongPressTimer, {passive: true}) // Inicia o timer ao tocar
		button.addEventListener('touchend', cancelLongPressTimer) // Cancela ao soltar o dedo
		button.addEventListener('touchmove', cancelLongPressTimer) // Cancela se o dedo mover (evita abrir menu ao rolar)
		button.addEventListener('touchcancel', cancelLongPressTimer) // Cancela se o toque for interrompido

		// -------------------------------------------------------------

		// Listener global para clique fora do dropdown para fechá-lo
		document.addEventListener('click', handleOutsideClick)

		// Injeta os estilos CSS necessários para a interface (botão, dropdown, overlay)
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
		dropdown.style.display = 'none' // Começa oculto por padrão
		return dropdown
	}

	/**
	 * Preenche o elemento dropdown com os grupos de modelos (padrão e customizados)
	 * e a opção para adicionar novos modelos. Adiciona links de reset de API Key.
	 * @param {HTMLElement} dropdownElement - O elemento do dropdown a ser preenchido.
	 */
	function populateDropdown(dropdownElement) {
		dropdownElement.innerHTML = '' // Limpa conteúdo anterior para reconstruir

		// Itera sobre cada grupo de serviço (OpenAI, Gemini) definido em MODEL_GROUPS
		Object.entries(MODEL_GROUPS).forEach(([service, group]) => {
			// Combina modelos padrão e customizados para este serviço específico
			const standardModels      = group.models || [] // Modelos padrão do grupo
			const serviceCustomModels = customModels
					.filter(m => m.service === service) // Filtra modelos customizados pelo serviço atual
					.map(m => ({id: m.id})) // Mapeia para o formato {id}, pois customizados não têm 'name' ou 'params' definidos aqui

			// Combina as listas e remove duplicatas baseadas no ID (ignorando maiúsculas/minúsculas)
			const allModelObjects = [...standardModels, ...serviceCustomModels]
					.reduce((acc, model) => {
						// Adiciona o modelo ao acumulador 'acc' apenas se um modelo com o mesmo ID (case-insensitive) ainda não existir
						if (!acc.some(existing => existing.id.toLowerCase() === model.id.toLowerCase())) {
							acc.push(model)
						}
						return acc
					}, [])
					.sort((a, b) => a.id.localeCompare(b.id)) // Ordena os modelos alfabeticamente pelo ID

			// Se houver modelos para este serviço após a combinação e filtragem
			if (allModelObjects.length > 0) {
				const groupDiv     = document.createElement('div') // Cria um container para o grupo
				groupDiv.className = 'model-group' // Classe para estilização
				// Cria o cabeçalho do grupo (Nome do Serviço + Link de Reset Key)
				groupDiv.appendChild(createHeader(group.name, service))
				// Adiciona cada item de modelo ao container do grupo
				allModelObjects.forEach(modelObj => groupDiv.appendChild(createModelItem(modelObj)))
				dropdownElement.appendChild(groupDiv) // Adiciona o grupo completo ao dropdown
			}
		})

		// Adiciona um separador visual antes do item "+ Adicionar"
		const separator           = document.createElement('hr')
		separator.style.margin    = '8px 0'
		separator.style.border    = 'none'
		separator.style.borderTop = '1px solid #eee' // Linha cinza clara
		dropdownElement.appendChild(separator)
		// Adiciona o item "+ Adicionar Modelo Customizado" ao final do dropdown
		dropdownElement.appendChild(createAddModelItem())
	}

	/**
	 * Cria um elemento de cabeçalho para um grupo de modelos no dropdown,
	 * incluindo o nome do serviço e um link funcional para resetar a API Key associada.
	 * @param {string} text - O texto do cabeçalho (nome do serviço, ex: "OpenAI").
	 * @param {string} service - A chave do serviço ('openai' ou 'gemini').
	 * @returns {HTMLElement} - O elemento div do cabeçalho completo.
	 */
	function createHeader(text, service) {
		// Container principal para alinhar o texto e o link usando flexbox
		const headerContainer     = document.createElement('div')
		headerContainer.className = 'group-header-container'

		// Span para exibir o nome do serviço
		const headerText       = document.createElement('span')
		headerText.className   = 'group-header-text'
		headerText.textContent = text // Ex: "OpenAI"

		// Link 'a' para a funcionalidade de resetar a API Key
		const resetLink       = document.createElement('a')
		resetLink.href        = '#' // Link vazio, a ação é via JS
		resetLink.textContent = 'Reset Key' // Texto do link
		resetLink.className   = 'reset-key-link' // Classe para estilização
		resetLink.title       = `Reset ${text} API Key` // Tooltip informativo
		// Listener de clique no link de reset
		resetLink.addEventListener('click', (e) => {
			e.preventDefault() // Previne a navegação padrão do link '#'
			e.stopPropagation() // Impede que o clique feche o dropdown imediatamente
			handleApiKeyReset(service) // Chama a função que lida com o reset da chave para este serviço
		})

		// Adiciona o texto e o link ao container
		headerContainer.appendChild(headerText)
		headerContainer.appendChild(resetLink)
		return headerContainer // Retorna o container completo do cabeçalho
	}

	/**
	 * Cria um item clicável para um modelo específico dentro do dropdown.
	 * Ao ser clicado, seleciona o modelo, fecha o dropdown e inicia a sumarização.
	 * @param {object} modelObj - O objeto do modelo contendo { id, name?, params? }.
	 * @returns {HTMLElement} - O elemento div do item do modelo.
	 */
	function createModelItem(modelObj) {
		const item     = document.createElement('div') // Cria o elemento div para o item
		item.className = 'model-item' // Classe para estilização
		// Define o texto do item: usa o nome amigável (modelObj.name) se existir, caso contrário, usa o ID do modelo
		item.textContent = modelObj.name || modelObj.id
		// Adiciona um destaque visual (negrito e cor) se este item corresponde ao modelo ativo atualmente
		if (modelObj.id === activeModel) {
			item.style.fontWeight = 'bold' // Negrito
			item.style.color      = '#1A73E8' // Azul para destacar
		}
		// Listener de clique no item do modelo
		item.addEventListener('click', async () => {
			activeModel = modelObj.id // Atualiza a variável global 'activeModel' com o ID selecionado
			await GM.setValue('last_used_model', activeModel) // Salva o ID do modelo selecionado no storage para persistência
			hideElement(DROPDOWN_ID) // Esconde o dropdown após a seleção
			processSummarization() // Inicia imediatamente o processo de sumarização com o novo modelo ativo
		})
		return item // Retorna o elemento do item criado
	}

	/**
	 * Cria o item clicável "+ Add Custom Model" no final do dropdown.
	 * Ao ser clicado, esconde o dropdown e inicia o fluxo para adicionar um novo modelo customizado.
	 * @returns {HTMLElement} - O elemento div do item "+ Add Custom Model".
	 */
	function createAddModelItem() {
		const item       = document.createElement('div') // Cria o elemento div
		item.id          = ADD_MODEL_ITEM_ID // ID específico para este item
		item.className   = 'model-item add-model-item' // Classes para estilização (geral e específica)
		item.textContent = '+ Add Custom Model' // Texto do item
		// Listener de clique no item "+ Add Custom Model"
		item.addEventListener('click', async (e) => {
			e.stopPropagation() // Impede que o clique feche o dropdown (que seria o comportamento padrão do handleOutsideClick)
			hideElement(DROPDOWN_ID) // Esconde o dropdown antes de mostrar os prompts para adicionar modelo
			await handleAddModel() // Chama a função que gerencia a adição de um modelo customizado
		})
		return item // Retorna o elemento do item criado
	}

	/**
	 * Mostra ou esconde o dropdown de seleção de modelo.
	 * Repopula o dropdown ao mostrar para garantir que a lista de modelos e o estado do link de reset estejam atualizados.
	 * @param {Event} [e] - O objeto do evento de clique/mousedown/touchstart (opcional, usado para stopPropagation).
	 */
	function toggleDropdown(e) {
		if (e) e.stopPropagation() // Impede que o evento (que abriu o dropdown) também o feche imediatamente via handleOutsideClick
		const dropdown = document.getElementById(DROPDOWN_ID)
		if (dropdown) {
			const isHidden = dropdown.style.display === 'none' // Verifica se o dropdown está atualmente oculto
			if (isHidden) {
				// Se estiver oculto, primeiro repopula com os dados mais recentes (modelos, status ativo)
				populateDropdown(dropdown)
				// Depois mostra o dropdown
				showElement(DROPDOWN_ID)
			} else {
				// Se estiver visível, apenas esconde
				hideElement(DROPDOWN_ID)
			}
		}
	}

	/**
	 * Fecha o dropdown se um clique ocorrer fora da área do dropdown e fora do botão 'S'.
	 * Previne o fechamento acidental ao clicar dentro do próprio dropdown ou no botão.
	 * @param {Event} event - O objeto do evento de clique global.
	 */
	function handleOutsideClick(event) {
		const dropdown = document.getElementById(DROPDOWN_ID)
		const button   = document.getElementById(BUTTON_ID)
		// Verifica se o dropdown existe, está visível, E se o alvo do clique NÃO está contido no dropdown NEM no botão 'S'
		if (dropdown && dropdown.style.display !== 'none' &&
				!dropdown.contains(event.target) && // O clique não foi dentro do dropdown
				!button?.contains(event.target)) { // O clique não foi no botão 'S' (usa optional chaining por segurança)
			hideElement(DROPDOWN_ID) // Esconde o dropdown
		}
	}

	/**
	 * Exibe o overlay de sumarização com o conteúdo HTML fornecido.
	 * Cria os elementos do overlay (fundo, container de conteúdo, botão de fechar) se não existirem.
	 * Adiciona um botão "Try Again" se `isError` for verdadeiro.
	 * @param {string} contentHTML - O conteúdo HTML a ser exibido (pode ser mensagem de loading, sumário ou erro).
	 * @param {boolean} [isError=false] - Indica se o conteúdo é uma mensagem de erro, para adicionar o botão "Try Again".
	 */
	function showSummaryOverlay(contentHTML, isError = false) {
		// Se o overlay já existe na página (por exemplo, de uma tentativa anterior),
		// apenas atualiza seu conteúdo em vez de criar um novo.
		if (document.getElementById(OVERLAY_ID)) {
			updateSummaryOverlay(contentHTML, isError)
			return
		}

		// Cria o elemento div principal do overlay (fundo escuro)
		const overlay    = document.createElement('div')
		overlay.id = OVERLAY_ID // Define o ID para estilização e referência

		// Cria o conteúdo interno do overlay, incluindo o botão de fechar ('×') e o conteúdo dinâmico (loading/sumário/erro)
		let finalContentHTML = `<div id="${CLOSE_BUTTON_ID}" title="Close (Esc)">×</div>${contentHTML}`
		// Se for uma mensagem de erro, adiciona o botão "Try Again" abaixo do conteúdo
		if (isError) {
			finalContentHTML += `<button id="${RETRY_BUTTON_ID}" class="retry-button">Try Again</button>`
		}
		// Define o HTML interno do container de conteúdo (caixa branca/escura no centro)
		overlay.innerHTML = `<div id="${CONTENT_ID}">${finalContentHTML}</div>`

		// Adiciona o overlay completo ao body do documento
		document.body.appendChild(overlay)
		// Trava o scroll da página principal enquanto o overlay estiver visível
		document.body.style.overflow = 'hidden'

		// Adiciona listeners de evento para fechar o overlay:
		// 1. Clicar no botão '×'
		document.getElementById(CLOSE_BUTTON_ID).addEventListener('click', closeOverlay)
		// 2. Clicar no fundo escuro do overlay (fora da caixa de conteúdo)
		overlay.addEventListener('click', e => e.target === overlay && closeOverlay()) // Fecha apenas se o clique for no próprio overlay

		// Adiciona listener para o botão "Try Again", se ele existir (em caso de erro)
		// Ao clicar, simplesmente chama a função processSummarization() novamente para tentar refazer a sumarização.
		document.getElementById(RETRY_BUTTON_ID)?.addEventListener('click', processSummarization)
	}

	/**
	 * Fecha e remove completamente o overlay de sumarização do DOM.
	 * Restaura o scroll normal da página principal.
	 */
	function closeOverlay() {
		const overlay = document.getElementById(OVERLAY_ID) // Encontra o elemento do overlay
		if (overlay) {
			overlay.remove() // Remove o overlay do DOM
			document.body.style.overflow = '' // Libera o scroll do body, restaurando o estado anterior
		}
	}

	/**
	 * Atualiza o conteúdo dentro de um overlay de sumarização já existente.
	 * Usado para mudar de "Loading..." para o sumário final ou para exibir uma mensagem de erro após o loading.
	 * Garante que o botão de fechar e o botão "Try Again" (se aplicável) sejam recriados corretamente com seus listeners.
	 * @param {string} contentHTML - O novo conteúdo HTML a ser inserido.
	 * @param {boolean} [isError=false] - Indica se o novo conteúdo é uma mensagem de erro, para adicionar o botão "Try Again".
	 */
	function updateSummaryOverlay(contentHTML, isError = false) {
		const contentDiv = document.getElementById(CONTENT_ID) // Encontra o container interno do conteúdo
		if (contentDiv) {
			// Recria o HTML interno, garantindo que o botão de fechar '×' sempre exista
			let finalContentHTML = `<div id="${CLOSE_BUTTON_ID}" title="Close (Esc)">×</div>${contentHTML}`
			// Adiciona o botão "Try Again" se for um erro
			if (isError) {
				finalContentHTML += `<button id="${RETRY_BUTTON_ID}" class="retry-button">Try Again</button>`
			}
			contentDiv.innerHTML = finalContentHTML // Substitui o conteúdo antigo pelo novo

			// Reatribui o listener de clique ao novo botão de fechar (o antigo foi removido com innerHTML)
			document.getElementById(CLOSE_BUTTON_ID)?.addEventListener('click', closeOverlay)
			// Reatribui o listener de clique ao novo botão "Try Again", se ele existir
			document.getElementById(RETRY_BUTTON_ID)?.addEventListener('click', processSummarization)
		}
	}

	/**
	 * Exibe uma notificação de erro temporária na parte inferior central da tela.
	 * Usada para erros que não justificam mostrar o overlay completo (ex: falha ao obter API key).
	 * @param {string} message - A mensagem de erro a ser exibida.
	 */
	function showErrorNotification(message) {
		document.getElementById(ERROR_ID)?.remove() // Remove qualquer notificação de erro anterior

		// Cria o elemento div para a notificação
		const errorDiv     = document.createElement('div')
		errorDiv.id        = ERROR_ID // ID para estilização e referência
		errorDiv.innerText = message // Define o texto da mensagem
		document.body.appendChild(errorDiv) // Adiciona ao body

		// Define um timer para remover automaticamente a notificação após 4 segundos
		setTimeout(() => errorDiv.remove(), 4000)
	}

	/**
	 * Esconde um elemento do DOM definindo seu estilo `display` como 'none'.
	 * @param {string} id - O ID do elemento a ser escondido.
	 */
	function hideElement(id) {
		const el = document.getElementById(id)
		if (el) el.style.display = 'none'
	}

	/**
	 * Mostra um elemento do DOM. Usa 'flex' para o botão 'S' (para centralizar o texto)
	 * e 'block' para outros elementos como o dropdown e o overlay.
	 * @param {string} id - O ID do elemento a ser mostrado.
	 */
	function showElement(id) {
		const el = document.getElementById(id)
		if (el) {
			// Define 'display' como 'flex' para o botão (conforme estilo CSS) e 'block' para outros (dropdown/overlay)
			el.style.display = (id === BUTTON_ID) ? 'flex' : 'block'
		}
	}

// --- Funções de Lógica (Sumarização, API, Modelos) ---

	/**
	 * Encontra o objeto de configuração completo para o modelo atualmente ativo (`activeModel`).
	 * Busca primeiro nos modelos padrão (`MODEL_GROUPS`) e depois nos modelos customizados (`customModels`).
	 * @returns {object|null} Um objeto contendo { id, service, name?, params? } se encontrado, ou null caso contrário.
	 *                        'name' e 'params' podem não estar presentes para modelos customizados.
	 */
	function getActiveModelConfig() {
		// Itera sobre os serviços definidos (openai, gemini)
		for (const service in MODEL_GROUPS) {
			const group = MODEL_GROUPS[service] // Acessa a configuração do grupo (baseUrl, models, defaultParams)
			// Tenta encontrar o modelo ativo dentro dos modelos padrão deste serviço
			const modelConfig = group.models.find(m => m.id === activeModel)
			if (modelConfig) {
				// Se encontrado, retorna uma cópia do objeto de configuração do modelo,
				// adicionando a chave 'service' para saber a qual serviço pertence.
				return {...modelConfig, service: service}
			}
		}
		// Se não encontrado nos modelos padrão, procura nos modelos customizados
		const customConfig = customModels.find(m => m.id === activeModel)
		if (customConfig) {
			// Se encontrado nos customizados, retorna uma cópia do objeto customizado { id, service }.
			// Modelos customizados, por padrão, não armazenam 'name' ou 'params' neste script.
			return {...customConfig}
		}
		// Se não encontrado em nenhum lugar, loga um erro e retorna null
		console.error(`Summarize with AI: Active model configuration not found for ID: ${activeModel}`)
		return null
	}

	/**
	 * Orquestra todo o processo de sumarização:
	 * 1. Verifica se os dados do artigo foram extraídos.
	 * 2. Obtém a configuração do modelo ativo.
	 * 3. Obtém a chave da API para o serviço correspondente.
	 * 4. Mostra o overlay com uma mensagem de "Loading..." e o nome do modelo.
	 * 5. Prepara e envia a requisição para a API de IA.
	 * 6. Trata a resposta da API (sucesso ou erro).
	 * 7. Exibe o sumário ou uma mensagem de erro no overlay.
	 */
	async function processSummarization() {
		try {
			// Etapa 1: Verifica se temos o conteúdo do artigo
			if (!articleData) {
				showErrorNotification('Article content not found or not readable.') // Notificação se não há artigo
				return // Interrompe se não há o que sumarizar
			}

			// Etapa 2: Obtém a configuração do modelo ativo
			const modelConfig = getActiveModelConfig()
			if (!modelConfig) {
				// Exibe erro se a configuração do modelo selecionado não for encontrada (pode acontecer se for removido)
				showErrorNotification(`Configuration for model "${activeModel}" not found. Please select another model.`)
				return // Interrompe
			}

			// Determina o nome a ser exibido no overlay (usa 'name' se disponível, senão 'id')
			const modelDisplayName = modelConfig.name || modelConfig.id
			const service     = modelConfig.service // Obtém o serviço ('openai' ou 'gemini') da configuração

			// Etapa 3: Obtém a chave da API
			const apiKey = await getApiKey(service)
			if (!apiKey) { // Se a chave não for encontrada ou estiver vazia
				// Monta mensagem de erro instruindo o usuário
				const errorMsg = `API key for ${service.toUpperCase()} is required. Click the 'Reset Key' link in the model selection menu (long-press 'S' button).`
				// Verifica se o overlay já está aberto (pode ser um retry após falha de chave)
				if (document.getElementById(OVERLAY_ID)) {
					// Mostra o erro dentro do overlay existente, sem botão de retry para este caso específico
					updateSummaryOverlay(`<p style="color: red;">${errorMsg}</p>`, false)
				} else {
					// Se o overlay não estava aberto, mostra como uma notificação flutuante
					showErrorNotification(errorMsg)
				}
				return // Interrompe se não houver chave de API
			}

			// Etapa 4: Mostra feedback de "Loading" no overlay
			const loadingMessage = `<p class="glow">Summarizing with ${modelDisplayName}... </p>` // Mensagem com efeito 'glow'
			// Verifica se o overlay já existe (caso seja um retry)
			if (document.getElementById(OVERLAY_ID)) {
				updateSummaryOverlay(loadingMessage) // Atualiza o overlay existente com a mensagem de loading
			} else {
				showSummaryOverlay(loadingMessage) // Cria um novo overlay com a mensagem de loading
			}

			// Etapa 5: Prepara e envia a requisição para a API
			// Prepara o payload com título, conteúdo do artigo e idioma do navegador
			const payload = {title: articleData.title, content: articleData.content, lang: navigator.language || 'en-US'}
			// Envia a requisição passando serviço, chave, payload e a configuração do modelo
			const response = await sendApiRequest(service, apiKey, payload, modelConfig)

			// Etapa 6: Trata a resposta da API
			handleApiResponse(response, service) // Processa a resposta (extrai sumário ou lança erro)

		} catch (error) {
			// Etapa 7: Exibe erros no overlay
			const errorMsg = `Error: ${error.message}` // Mensagem de erro concisa
			console.error('Summarize with AI:', errorMsg, error) // Loga o erro completo no console para depuração
			// Mostra a mensagem de erro no overlay (criando um novo se não existir)
			// e inclui o botão "Try Again" (isError = true)
			showSummaryOverlay(`<p style="color: red;">${errorMsg}</p>`, true)
			hideElement(DROPDOWN_ID) // Garante que o dropdown esteja oculto em caso de erro
		}
	}

	/**
	 * Envia a requisição HTTP para a API de IA (OpenAI ou Gemini) usando GM.xmlHttpRequest.
	 * @param {string} service - O nome do serviço ('openai' ou 'gemini').
	 * @param {string} apiKey - A chave da API para autenticação.
	 * @param {object} payload - Objeto contendo { title, content, lang } do artigo.
	 * @param {object} modelConfig - A configuração completa do modelo ativo { id, service, name?, params? }.
	 * @returns {Promise<object>} - Uma promessa que resolve com um objeto contendo { status, data, statusText } da resposta HTTP.
	 *                              'data' será o objeto JSON parseado ou um objeto vazio em caso de falha no parse.
	 */
	async function sendApiRequest(service, apiKey, payload, modelConfig) {
		const group = MODEL_GROUPS[service] // Obtém a configuração base do serviço (URL, etc.)
		// Define a URL da API específica para o serviço
		const url   = service === 'openai'
				? group.baseUrl // URL base da API OpenAI (modelo é enviado no corpo)
				: `${group.baseUrl}${modelConfig.id}:generateContent?key=${apiKey}` // URL da API Gemini (ID do modelo e chave na URL)

		// Retorna uma nova Promise que encapsula a chamada GM.xmlHttpRequest
		return new Promise((resolve, reject) => {
			GM.xmlHttpRequest({
				method:       'POST', // Método HTTP para enviar dados
				url:          url, // URL da API definida acima
				headers:      getHeaders(service, apiKey), // Obtém os cabeçalhos HTTP necessários (Content-Type, Authorization se OpenAI)
				// Constrói o corpo da requisição (JSON) específico para o serviço e modelo
				data:         JSON.stringify(buildRequestBody(service, payload, modelConfig)),
				responseType: 'json', // Indica ao Tampermonkey para tentar parsear a resposta como JSON automaticamente
				timeout:      60000, // Define um timeout de 60 segundos para a requisição
				// Callback executado quando a requisição é concluída com sucesso (status HTTP recebido)
				onload:       response => {
					// GM.xmlHttpRequest pode retornar o JSON parseado em 'response.response'
					// ou a string original em 'response.responseText'. Precisamos lidar com ambos.
					const responseData = response.response || response.responseText
					// Resolve a Promise com um objeto contendo o status HTTP, os dados (parseados ou string) e o statusText
					resolve({
						status: response.status,
						// Tenta garantir que 'data' seja um objeto, mesmo que 'responseType: json' falhe
						data:       typeof responseData === 'object' ? responseData : JSON.parse(responseData || '{}'),
						statusText: response.statusText,
					})
				},
				// Callbacks para diferentes tipos de erro na requisição
				onerror:   error => reject(new Error(`Network error: ${error.statusText || 'Failed to connect'}`)), // Erro de rede
				onabort:   () => reject(new Error('Request aborted')), // Requisição abortada
				ontimeout: () => reject(new Error('Request timed out after 60 seconds')), // Timeout atingido
			})
		})
	}

	/**
	 * Processa a resposta recebida da API de IA.
	 * Verifica o status HTTP, extrai o conteúdo do sumário do corpo da resposta (dependendo do serviço),
	 * lida com possíveis erros da API (como bloqueio por segurança ou limites de token),
	 * limpa o texto do sumário e atualiza o overlay com o resultado final.
	 * @param {object} response - O objeto de resposta resolvido da Promise de `sendApiRequest` (contém status, data, statusText).
	 * @param {string} service - O nome do serviço que respondeu ('openai' ou 'gemini').
	 * @throws {Error} - Lança um erro se a API retornar um status não-2xx, se a resposta não contiver um sumário válido,
	 *                   ou se ocorrer um bloqueio por segurança.
	 */
	function handleApiResponse(response, service) {
		const {status, data, statusText} = response // Desestrutura o objeto de resposta

		// Verifica se o status HTTP indica sucesso (códigos 200-299)
		if (status < 200 || status >= 300) {
			// Tenta extrair uma mensagem de erro mais específica do corpo da resposta JSON
			// (OpenAI usa data.error.message, Gemini pode usar data.message ou data.error.message)
			const errorDetails = data?.error?.message || data?.message || statusText || 'Unknown API error'
			// Lança um erro que será capturado pelo 'catch' em processSummarization
			throw new Error(`API Error (${status}): ${errorDetails}`)
		}

		// Extrai o texto bruto do sumário da resposta, dependendo da estrutura de cada API
		let rawSummary = '' // Inicializa a variável para o sumário
		if (service === 'openai') {
			// Para OpenAI, o sumário está em choices[0].message.content
			const choice = data?.choices?.[0]
			rawSummary   = choice?.message?.content

			// Loga o motivo pelo qual a geração parou (útil para depuração)
			const finishReason = choice?.finish_reason
			console.log(`Summarize with AI: OpenAI Finish Reason: ${finishReason} (Model: ${activeModel})`)
			// Adiciona um aviso se o sumário foi cortado por atingir o limite de tokens
			if (finishReason === 'length') {
				console.warn('Summarize with AI: Summary may be incomplete because the max token limit was reached.')
			}

		} else if (service === 'gemini') {
			// Para Gemini, o sumário está em candidates[0].content.parts[0].text
			const candidate    = data?.candidates?.[0]
			const finishReason = candidate?.finishReason // Motivo da finalização (STOP, MAX_TOKENS, SAFETY, etc.)
			console.log(`Summarize with AI: Gemini Finish Reason: ${finishReason} (Model: ${activeModel})`)

			// Verifica se a finalização foi devido a bloqueio de segurança
			if (finishReason === 'SAFETY') {
				// Tenta obter detalhes das categorias de segurança que causaram o bloqueio
				const safetyRatings = candidate.safetyRatings?.map(r => `${r.category}: ${r.probability}`).join(', ')
				// Lança um erro específico para bloqueio de segurança
				throw new Error(`Content blocked due to safety concerns (${safetyRatings || 'No details'}).`)
			}
			// Adiciona um aviso se o sumário foi cortado por atingir o limite de tokens
			if (finishReason === 'MAX_TOKENS') {
				console.warn('Summarize with AI: Summary may be incomplete because the max token limit was reached.')
			}

			// Extrai o texto da parte principal da resposta do candidato
			// Verificação robusta para garantir que 'parts' existe e contém texto
			if (candidate?.content?.parts?.length > 0 && candidate.content.parts[0].text) {
				rawSummary = candidate.content.parts[0].text
			} else if (finishReason && !['STOP', 'SAFETY', 'MAX_TOKENS'].includes(finishReason)) {
				// Loga um aviso se o motivo da finalização for inesperado e não houver texto
				console.warn(`Summarize with AI: Gemini response structure missing expected text content or unusual finish reason: ${finishReason}`, candidate)
			} else if (!rawSummary && !data?.error) { // Se não houver texto E não for um erro já tratado
				// Loga um aviso se a estrutura esperada estiver ausente
				console.warn('Summarize with AI: Gemini response structure missing expected text content.', candidate)
			}
			// Se rawSummary continuar vazio aqui, o erro "did not contain valid summary" será lançado abaixo.
		}

		// Verifica se, após a extração, a variável rawSummary contém algum texto.
		// Ignora esta verificação se já houver um erro explícito na resposta (data.error)
		if (!rawSummary && !data?.error) {
			console.error('Summarize with AI: API Response Data:', data) // Loga a resposta completa para depuração
			throw new Error('API response did not contain a valid summary.') // Lança erro se o sumário estiver vazio
		}

		// Limpa quebras de linha (\n) que não fazem parte de tags HTML (substitui por espaço)
		// e comprime múltiplos espaços em um único espaço.
		// Isso melhora a formatação caso a API retorne quebras de linha desnecessárias.
		const cleanedSummary = rawSummary.replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim()

		// Atualiza o overlay com o sumário final limpo.
		// Passa 'false' para isError, indicando que é um sucesso e não precisa do botão "Try Again".
		updateSummaryOverlay(cleanedSummary, false)
	}

	/**
	 * Constrói o objeto do corpo (payload) da requisição para a API (OpenAI ou Gemini).
	 * Inclui o prompt do sistema e os parâmetros de geração (como max tokens),
	 * usando valores específicos do modelo (modelConfig.params) ou os padrões do serviço (MODEL_GROUPS[service].defaultParams).
	 * @param {string} service - O nome do serviço ('openai' ou 'gemini').
	 * @param {object} payload - Objeto com { title, content, lang } do artigo.
	 * @param {object} modelConfig - A configuração completa do modelo ativo { id, service, name?, params? }.
	 * @returns {object} - O objeto pronto para ser serializado em JSON e enviado como corpo da requisição.
	 */
	function buildRequestBody(service, {title, content, lang}, modelConfig) {
		// Gera o prompt completo que será enviado à IA, incluindo instruções e o conteúdo do artigo
		const systemPrompt = PROMPT_TEMPLATE(title, content, lang)
		// Obtém os parâmetros padrão definidos para o serviço (ex: default max tokens)
		const serviceDefaults     = MODEL_GROUPS[service]?.defaultParams || {}
		// Obtém os parâmetros específicos definidos para este modelo (se houver)
		const modelSpecificParams = modelConfig?.params || {}

		if (service === 'openai') {
			// Mescla os parâmetros: os específicos do modelo sobrescrevem os padrões do serviço
			const finalParams = {...serviceDefaults, ...modelSpecificParams}

			// Retorna a estrutura de corpo esperada pela API OpenAI Chat Completions
			return {
				model:    modelConfig.id, // ID do modelo a ser usado
				messages: [
					{role: 'system', content: systemPrompt}, // O prompt principal como mensagem do sistema
					{role: 'user', content: 'Generate the summary as requested.'} // Uma mensagem curta do usuário para iniciar a resposta
				],
				// Inclui os parâmetros de geração mesclados (ex: max_completion_tokens)
				...finalParams
				// 'temperature', 'top_p', etc., podem ser adicionados aqui ou nos params do modelo/serviço
			}
		} else { // gemini
			// Mescla os parâmetros para a seção 'generationConfig' do Gemini
			const finalGenConfigParams = {...serviceDefaults, ...modelSpecificParams}

			// Retorna a estrutura de corpo esperada pela API Gemini generateContent
			return {
				contents: [{
					parts: [{text: systemPrompt}], // O prompt principal vai dentro de 'contents' -> 'parts'
					// role não é necessário aqui para um prompt simples
				}],
				// Inclui a 'generationConfig' com os parâmetros mesclados (ex: maxOutputTokens)
				generationConfig: finalGenConfigParams
				// 'temperature', 'topP', 'topK' podem ser adicionados aqui ou nos params do modelo/serviço
			}
		}
	}

	/**
	 * Retorna os cabeçalhos HTTP apropriados para a requisição à API.
	 * @param {string} service - O nome do serviço ('openai' ou 'gemini').
	 * @param {string} apiKey - A chave da API.
	 * @returns {object} - Um objeto contendo os cabeçalhos HTTP necessários.
	 */
	function getHeaders(service, apiKey) {
		// Cabeçalho comum a todas as requisições
		const headers = {'Content-Type': 'application/json'}
		// Adiciona o cabeçalho de Autorização específico para OpenAI
		if (service === 'openai') {
			headers['Authorization'] = `Bearer ${apiKey}` // OpenAI usa autenticação Bearer Token
		}
		// Gemini inclui a chave de API na URL da requisição (veja sendApiRequest),
		// então nenhum cabeçalho de autorização adicional é necessário aqui.
		return headers
	}

	/**
	 * Obtém a chave da API para o serviço especificado a partir do armazenamento seguro do GM (GM.getValue).
	 * Se a chave não estiver armazenada ou estiver vazia, retorna null.
	 * A verificação se a chave é necessária e a solicitação ao usuário (se ausente) ocorrem em `processSummarization`.
	 * @param {string} service - O nome do serviço ('openai' ou 'gemini') para o qual obter a chave.
	 * @returns {Promise<string|null>} - Uma promessa que resolve com a string da chave da API ou null se não encontrada/vazia.
	 */
	async function getApiKey(service) {
		const storageKey = `${service}_api_key` // Chave usada para armazenar no GM storage (ex: 'openai_api_key')
		let apiKey       = await GM.getValue(storageKey) // Lê o valor do storage
		// Retorna a chave se ela existir e não for apenas espaços em branco, caso contrário, retorna null.
		return apiKey?.trim() || null
	}

	/**
	 * Permite ao usuário resetar (redefinir ou limpar) a chave da API para um serviço específico.
	 * Solicita a nova chave através de um prompt do navegador.
	 * Ativado pelo link 'Reset Key' no cabeçalho de cada grupo no dropdown de modelos.
	 * @param {string} service - O serviço ('openai' ou 'gemini') para o qual resetar a chave.
	 */
	async function handleApiKeyReset(service) {
		// Validação básica para garantir que um serviço válido foi passado
		if (!service || !MODEL_GROUPS[service]) {
			console.error("Invalid service provided for API key reset:", service)
			alert("Internal error: Invalid service provided.")
			return
		}

		const storageKey = `${service}_api_key` // Chave do storage para esta API key
		// Pede a nova chave ao usuário via prompt. O usuário pode digitar a chave, deixar em branco ou cancelar.
		const newKey     = prompt(`Enter the new ${service.toUpperCase()} API key (leave blank to clear):`)

		// Verifica se o usuário não clicou em "Cancelar" (prompt retorna null se cancelado)
		if (newKey !== null) {
			// Remove espaços extras da chave digitada (ou string vazia se deixado em branco)
			const keyToSave = newKey.trim()
			// Salva a nova chave (ou string vazia) no GM storage, sobrescrevendo a anterior
			await GM.setValue(storageKey, keyToSave)
			// Informa o usuário sobre a ação realizada
			if (keyToSave) {
				alert(`${service.toUpperCase()} API key updated!`) // Mensagem se a chave foi atualizada
			} else {
				alert(`${service.toUpperCase()} API key cleared!`) // Mensagem se a chave foi limpa
			}
			// Opcional: Se o dropdown estiver visível, poderia ser repopulado aqui para refletir
			// alguma mudança visual, mas atualmente não há indicação visual da presença da chave.
			// const dropdown = document.getElementById(DROPDOWN_ID)
			// if (dropdown && dropdown.style.display !== 'none') {
			//     populateDropdown(dropdown)
			// }
		}
		// Se newKey for null (usuário clicou em Cancelar no prompt), nenhuma ação é tomada.
	}

	/**
	 * Gerencia o fluxo interativo para adicionar um novo modelo customizado.
	 * Pede ao usuário, via prompts do navegador, o serviço (OpenAI/Gemini) e o ID exato do modelo.
	 * Valida as entradas e chama `addCustomModel` para salvar.
	 */
	async function handleAddModel() {
		// 1. Pergunta o serviço (OpenAI ou Gemini)
		// Converte para minúsculas e remove espaços para validação
		const service = prompt('Enter the service for the custom model (openai / gemini):')?.toLowerCase()?.trim()
		// Valida se o serviço é 'openai' ou 'gemini' e se não foi cancelado
		if (!service || !MODEL_GROUPS[service]) {
			// Mostra alerta apenas se o usuário digitou algo inválido (não se cancelou)
			if (service !== null) alert('Invalid service. Please enter "openai" or "gemini".')
			return // Cancela o fluxo se o serviço for inválido ou o prompt for cancelado
		}

		// 2. Pergunta o nome exato (ID) do modelo
		// Remove espaços extras do ID digitado
		const modelId = prompt(`Enter the exact ID of the ${service.toUpperCase()} model:`)?.trim()
		// Valida se o ID não está vazio e se não foi cancelado
		if (!modelId) {
			// Mostra alerta apenas se o usuário deixou em branco (não se cancelou)
			if (modelId !== null) alert('Model ID cannot be empty.')
			return // Cancela o fluxo se o ID for vazio ou o prompt for cancelado
		}

		// 3. Chama a função para adicionar o modelo e salvar no storage
		await addCustomModel(service, modelId)
		// Nota: Após adicionar, o dropdown não é reaberto automaticamente. O usuário precisará
		// fazer long-press novamente para ver o modelo adicionado na lista.
	}

	/**
	 * Adiciona um novo modelo customizado à lista em memória (`customModels`) e
	 * salva a lista atualizada no GM storage.
	 * Verifica se um modelo com o mesmo ID (case-insensitive) já existe (seja padrão ou customizado)
	 * para evitar duplicatas. Salva no formato { id: string, service: string }.
	 * @param {string} service - O serviço do modelo ('openai' ou 'gemini').
	 * @param {string} modelId - O ID exato do modelo a ser adicionado.
	 */
	async function addCustomModel(service, modelId) {
		// Verifica se o ID do modelo já existe na lista de customizados para este serviço (ignorando case)
		const existsInCustom   = customModels.some(m => m.service === service && m.id.toLowerCase() === modelId.toLowerCase())
		// Verifica também se o ID já existe nos modelos padrão definidos em MODEL_GROUPS (ignorando case)
		const existsInStandard = MODEL_GROUPS[service]?.models.some(m => m.id.toLowerCase() === modelId.toLowerCase())

		// Se o modelo já existir em qualquer uma das listas
		if (existsInCustom || existsInStandard) {
			alert(`Model ID "${modelId}" already exists for ${service.toUpperCase()}.`) // Informa o usuário
			return // Interrompe a adição
		}

		// Se não existe, adiciona o novo modelo (como objeto {id, service}) à lista em memória
		customModels.push({id: modelId, service})
		// Salva a lista completa e atualizada de modelos customizados no GM storage como uma string JSON
		await GM.setValue(CUSTOM_MODELS_KEY, JSON.stringify(customModels))
		// Informa o usuário que o modelo foi adicionado com sucesso
		alert(`Custom model "${modelId}" (${service.toUpperCase()}) added!`)
	}

	/**
	 * Carrega a lista de modelos customizados salvos no GM storage.
	 * Faz parse da string JSON armazenada e realiza uma validação básica
	 * para garantir que o formato seja um array de objetos, cada um com `id` e `service`.
	 * Em caso de formato inválido ou erro de parse, reseta o storage para '[]' e retorna um array vazio.
	 * @returns {Promise<Array<object>>} - Uma promessa que resolve com o array de objetos de modelos customizados [{ id, service }, ...].
	 */
	async function getCustomModels() {
		try {
			// Obtém a string JSON do storage, usando '[]' como valor padrão se a chave não existir
			const storedModels = await GM.getValue(CUSTOM_MODELS_KEY, '[]')
			// Faz o parse da string JSON para um objeto JavaScript
			const parsedModels = JSON.parse(storedModels)
			// Validação: Verifica se é um array e se cada item é um objeto com as propriedades 'id' e 'service'
			if (Array.isArray(parsedModels) && parsedModels.every(m => typeof m === 'object' && m.id && m.service)) {
				return parsedModels // Retorna os modelos customizados válidos
			} else {
				// Se o formato for inválido, loga um aviso, reseta o storage e retorna um array vazio
				console.warn("Summarize with AI: Invalid custom model format found in storage. Resetting.", parsedModels)
				await GM.setValue(CUSTOM_MODELS_KEY, '[]') // Limpa o valor inválido no storage
				return []
			}
		} catch (error) {
			// Se ocorrer um erro durante o getValue ou JSON.parse
			console.error('Summarize with AI: Failed to load/parse custom models:', error)
			// Tenta resetar o storage para um estado limpo em caso de erro de parse
			await GM.setValue(CUSTOM_MODELS_KEY, '[]')
			return [] // Retorna um array vazio em caso de erro
		}
	}

// --- Funções de Eventos e Utilidades ---

	/**
	 * Manipulador global para eventos de teclado.
	 * Ouve por Alt+S para iniciar a sumarização e Esc para fechar o overlay ou o dropdown.
	 * @param {KeyboardEvent} e - O objeto do evento de teclado.
	 */
	function handleKeyPress(e) {
		// Atalho Alt+S: Simula um clique simples no botão 'S' para iniciar a sumarização
		if (e.altKey && e.code === 'KeyS' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { // Verifica Alt+S sem outros modificadores
			e.preventDefault() // Previne qualquer ação padrão do navegador para Alt+S
			const button = document.getElementById(BUTTON_ID)
			// Verifica se o botão 'S' existe na página (ou seja, se um artigo foi detectado)
			if (button) {
				// Verifica se um campo de input NÃO está focado antes de disparar
				if (!document.activeElement?.closest('input, textarea, select, [contenteditable="true"]')) {
					processSummarization() // Chama a função principal de sumarização
				}
			}
		}
		// Tecla Esc: Fecha elementos abertos pelo script
		if (e.key === 'Escape') {
			// Prioridade 1: Fechar o overlay de sumário/erro se estiver aberto
			if (document.getElementById(OVERLAY_ID)) {
				e.preventDefault() // Previne que o Esc feche outras coisas na página
				closeOverlay()
			}
			// Prioridade 2: Fechar o dropdown de modelos se estiver aberto e o overlay não estiver
			else if (document.getElementById(DROPDOWN_ID)?.style.display !== 'none') {
				e.preventDefault() // Previne que o Esc feche outras coisas
				hideElement(DROPDOWN_ID)
			}
		}
	}

	/**
	 * Configura listeners de foco para esconder/mostrar o botão 'S' automaticamente.
	 * Esconde o botão quando o usuário foca em um campo de input/textarea/select/contenteditable.
	 * Mostra o botão novamente quando o foco sai desses campos (e volta para o corpo da página, por exemplo).
	 */
	function setupFocusListeners() {
		// Listener 'focusin': Disparado quando um elemento na página recebe foco (incluindo via tabulação).
		document.addEventListener('focusin', (event) => {
			// Verifica se o elemento que recebeu foco (event.target) é ou está dentro de um campo editável.
			if (event.target?.closest('input, textarea, select, [contenteditable="true"]')) {
				hideElement(BUTTON_ID) // Esconde o botão 'S'
				hideElement(DROPDOWN_ID) // Esconde também o dropdown se estiver aberto
			}
		})

		// Listener 'focusout': Disparado quando um elemento perde o foco.
		document.addEventListener('focusout', (event) => {
			// Verifica se o elemento que perdeu foco (event.target) era um campo editável.
			const isLeavingInput  = event.target?.closest('input, textarea, select, [contenteditable="true"]')
			// Verifica se o novo elemento que recebeu foco (event.relatedTarget) NÃO é um campo editável.
			// 'relatedTarget' é null se o foco saiu da janela ou foi para o body.
			const isEnteringInput = event.relatedTarget?.closest('input, textarea, select, [contenteditable="true"]')

			// Mostra o botão 'S' somente se as seguintes condições forem verdadeiras:
			// 1. O foco estava em um campo editável (isLeavingInput).
			// 2. O foco NÃO está indo para outro campo editável (isEnteringInput é falso/null).
			// 3. O script detectou um artigo legível (articleData existe).
			if (isLeavingInput && !isEnteringInput && articleData) {
				// Usa um pequeno delay (50ms) antes de mostrar o botão.
				// Isso evita que o botão pisque rapidamente se o usuário tabular entre campos editáveis.
				setTimeout(() => {
					// Reconfirma no momento de mostrar: garante que o foco *atual* não é um input
					// (o foco pode ter mudado novamente durante o delay).
					if (!document.activeElement?.closest('input, textarea, select, [contenteditable="true"]')) {
						showElement(BUTTON_ID) // Mostra o botão 'S'
					}
				}, 50)
			}
		}, true) // Usa 'capture: true' para garantir que o evento 'focusout' seja capturado de forma confiável.
	}

	/**
	 * Injeta os estilos CSS necessários para a interface do script (botão, dropdown, overlay, etc.).
	 * Inclui estilos para dark mode e responsividade móvel.
	 */
	function injectStyles() {
		// Estilos CSS injetados usando GM.addStyle
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
        /* display é controlado por show/hideElement, mas !important garante sobreposição se necessário */
        display: flex !important; align-items: center !important; justify-content: center !important; /* Centraliza 'S' */
        transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
        line-height: 1; user-select: none; /* Previne seleção de texto */
        -webkit-tap-highlight-color: transparent; /* Remove highlight azul no toque (iOS/Android) */
      }
      #${BUTTON_ID}:hover {
        transform: scale(1.1); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
      }
      #${DROPDOWN_ID} {
        position: fixed; bottom: 80px; right: 20px; /* Posicionado acima do botão 'S' */
        background: #ffffff; border: 1px solid #e0e0e0; border-radius: 10px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15); z-index: 2147483641; /* Z-index maior que o botão */
        max-height: 70vh; overflow-y: auto; /* Permite scroll se a lista for longa */
        padding: 8px; width: 300px; /* Dimensões e espaçamento interno */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        display: none; /* Começa oculto (controlado por show/hideElement) */
        animation: fadeIn 0.2s ease-out; /* Animação suave ao aparecer */
      }
      #${OVERLAY_ID} {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(0, 0, 0, 0.6); /* Fundo semi-transparente (padrão light) */
        z-index: 2147483645; /* Z-index muito alto para ficar sobre tudo */
        display: flex; align-items: center; justify-content: center; /* Centraliza o conteúdo */
        overflow: hidden; /* Impede scroll do body enquanto aberto */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        animation: fadeIn 0.3s ease-out; /* Animação suave ao aparecer */
      }
      #${CONTENT_ID} {
        background-color: #fff; /* Fundo branco (padrão light) */
        color: #333; /* Texto escuro (padrão light) */
        padding: 25px 35px; border-radius: 12px; /* Espaçamento interno e bordas arredondadas */
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        max-width: 800px; width: 90%; max-height: 85vh; /* Limites de tamanho */
        overflow-y: auto; /* Scroll interno se o conteúdo for maior que a altura máxima */
        position: relative; /* Para posicionamento absoluto do botão de fechar */
        font-size: 16px; line-height: 1.6; /* Tamanho e espaçamento de linha do texto */
        animation: slideInUp 0.3s ease-out; /* Animação de entrada (desliza de baixo para cima) */
        white-space: normal; /* Permite quebra de linha normal baseada no HTML */
        box-sizing: border-box; /* Garante que padding não aumente o tamanho total além de max-width/width */
      }
      #${CONTENT_ID} p { margin-top: 0; margin-bottom: 1em; } /* Margem padrão para parágrafos dentro do conteúdo */
      #${CONTENT_ID} ul { margin: 1em 0; padding-left: 1.5em; } /* Adiciona padding à esquerda para listas (bullet points com emoji) */
      #${CONTENT_ID} li { list-style-type: none; margin-bottom: 0.5em; } /* Remove marcador padrão da lista (usa emoji) e adiciona espaço abaixo */
      #${CLOSE_BUTTON_ID} {
        position: absolute; top: 10px; right: 15px; /* Canto superior direito do conteúdo */
        font-size: 28px; color: #aaa; /* Cinza claro (padrão light) */
        cursor: pointer;
        transition: color 0.2s; line-height: 1; z-index: 1; /* Garante que fique acima do texto scrollável */
      }
      #${CLOSE_BUTTON_ID}:hover { color: #333; } /* Cor mais escura no hover (light) */
      #${ERROR_ID} {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); /* Centralizado na parte inferior */
        background-color: #e53e3e; color: white; padding: 12px 20px; /* Vermelho para erro */
        border-radius: 6px; z-index: 2147483646; /* Acima de tudo, até do overlay */
        font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        animation: fadeIn 0.3s, fadeOut 0.3s 3.7s forwards; /* Fade in, espera 3.7s, fade out */
      }
      .retry-button { /* Estilo para o botão "Try Again" em caso de erro */
        display: block; margin: 20px auto 0; padding: 8px 16px; /* Centralizado abaixo do erro */
        background-color: #4a90e2; /* Azul (padrão light) */
        color: white; border: none; border-radius: 5px;
        cursor: pointer; font-size: 14px; transition: background-color 0.2s;
      }
      .retry-button:hover { background-color: #3a7bd5; } /* Azul mais escuro no hover (light) */

      /* --- Estilos do Dropdown --- */
      .model-group { margin-bottom: 8px; } /* Espaço abaixo de cada grupo de modelos */
      .group-header-container { /* Container para Nome do Serviço + Link Reset Key */
        display: flex; align-items: center; justify-content: space-between; /* Alinhamento flex */
        padding: 8px 12px; background: #f7f7f7; /* Fundo cinza claro */
        border-radius: 6px; margin-bottom: 4px; /* Bordas arredondadas e espaço abaixo */
      }
      .group-header-text { /* Texto do nome do serviço (ex: OpenAI) */
        font-weight: 600; color: #333; font-size: 13px;
        text-transform: uppercase; letter-spacing: 0.5px; /* Estilo de título */
        flex-grow: 1; /* Ocupa espaço disponível, empurrando o link para a direita */
      }
      .reset-key-link { /* Link "Reset Key" */
        font-size: 11px; color: #666; text-decoration: none;
        margin-left: 10px; /* Espaço à esquerda */
        white-space: nowrap; /* Impede quebra de linha */
        cursor: pointer;
        transition: color 0.2s;
      }
      .reset-key-link:hover { color: #1a73e8; } /* Azul no hover */
      .model-item { /* Estilo para cada item de modelo clicável */
        padding: 10px 14px; margin: 2px 0; border-radius: 6px; /* Espaçamento e bordas */
        transition: background-color 0.15s ease-out, color 0.15s ease-out; /* Transição suave no hover */
        font-size: 14px; cursor: pointer; color: #444; display: block; /* Estilo de texto e cursor */
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; /* Evita quebra e adiciona '...' em nomes longos */
      }
      .model-item:hover { background-color: #eef6ff; color: #1a73e8; } /* Efeito hover (fundo azul claro, texto azul) */
      .add-model-item { /* Estilo adicional para o item "+ Add Custom Model" */
         color: #666; /* Cor mais apagada */
         font-style: italic; /* Itálico */
      }
      .add-model-item:hover { background-color: #f0f0f0; color: #333; } /* Hover diferente para o item de adicionar */

      /* --- Estilos de Conteúdo (Glow, Qualidade do Artigo) --- */
      .glow { /* Efeito de brilho pulsante para a mensagem "Summarizing..." */
        font-size: 1.4em; text-align: center; padding: 40px 0;
        /* Aplica a animação 'glow' definida abaixo */
        animation: glow 2.5s ease-in-out infinite;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-weight: 400;
      }
      /* Cores para as classes de qualidade do artigo (usadas no span dentro do sumário) */
      span.article-excellent { color: #2ecc71; font-weight: bold; } /* Verde brilhante */
      span.article-good      { color: #3498db; font-weight: bold; } /* Azul */
      span.article-average   { color: #f39c12; font-weight: bold; } /* Laranja */
      span.article-bad       { color: #e74c3c; font-weight: bold; } /* Vermelho */
      span.article-very-bad  { color: #c0392b; font-weight: bold; } /* Vermelho escuro */

      /* --- Animações --- */
      /* Keyframes para a animação 'glow': cicla entre azul, roxo e vermelho com sombra de texto */
      @keyframes glow {
        0%, 100% { color: #4a90e2; text-shadow: 0 0 10px rgba(74, 144, 226, 0.6), 0 0 20px rgba(74, 144, 226, 0.4); } /* Azul */
        33%      { color: #9b59b6; text-shadow: 0 0 12px rgba(155, 89, 182, 0.7), 0 0 25px rgba(155, 89, 182, 0.5); } /* Roxo */
        66%      { color: #e74c3c; text-shadow: 0 0 12px rgba(231, 76, 60, 0.7), 0 0 25px rgba(231, 76, 60, 0.5); } /* Vermelho */
      }
      /* Animação simples de Fade In (usada no overlay, dropdown, notificação de erro) */
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      /* Animação simples de Fade Out (usada na notificação de erro) */
      @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
      /* Animação de Slide In de baixo para cima (usada no conteúdo do overlay) */
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
        /* Botão de fechar ('×') com cores invertidas */
        #${CLOSE_BUTTON_ID} {
          color: #888; /* Cinza médio */
        }
        #${CLOSE_BUTTON_ID}:hover {
          color: #eee; /* Quase branco no hover */
        }
        /* Botão "Try Again" com estilo adaptado para dark mode */
        .retry-button {
          background-color: #555; /* Cinza médio */
          color: #eee; /* Texto claro */
        }
        .retry-button:hover {
          background-color: #666; /* Cinza um pouco mais claro no hover */
        }
        /* Dropdown com fundo escuro e texto claro */
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
        /* Itens do cabeçalho do grupo no dropdown */
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
        /* Item "+ Add Custom Model" no dropdown */
        .add-model-item {
           color: #999; /* Item de adicionar mais claro */
        }
        .add-model-item:hover {
           background-color: #4a4a4a; /* Fundo de hover */
           color: #eee; /* Texto claro no hover */
        }
        /* Separador (linha hr) no dropdown */
        hr {
           /* !important pode ser necessário para sobrescrever estilos inline */
           border-top-color: #555 !important;
        }
        /* Cores de qualidade (opcionalmente ajustar para melhor contraste em dark mode) */
        /* span.article-excellent { color: #36d880; } */
        /* span.article-good      { color: #4aa9f2; } */
        /* As cores atuais parecem ter contraste razoável, mantendo por enquanto */

        /* Ajuste de cor para o brilho 'glow' no modo escuro (opcional) */
        /* As cores atuais do glow parecem funcionar bem, mas poderiam ser ajustadas aqui */
        /* @keyframes glow-dark { ... } */
        /* .glow { animation-name: glow-dark; } */
      }

      /* --- Mobile Responsiveness --- */
      /* Ajustes para telas pequenas (ex: smartphones com largura máxima de 600px) */
      @media (max-width: 600px) {
         /* Faz o conteúdo do overlay ocupar a tela inteira para melhor uso do espaço */
         #${CONTENT_ID} {
            width: 100%;        /* Largura total */
            height: 100%;       /* Altura total */
            max-width: none;    /* Remove limite de largura máxima */
            max-height: none;   /* Remove limite de altura máxima */
            border-radius: 0;   /* Remove cantos arredondados (visual edge-to-edge) */
            padding: 20px 15px; /* Ajusta padding interno para telas menores */
            box-shadow: none;   /* Remove sombra (opcional, visual mais limpo) */
            animation: none;    /* Desabilita animação slideInUp em mobile (opcional) */
            font-size: 15px;    /* Pode reduzir um pouco a fonte se necessário */
         }
         /* Ajusta posição do botão de fechar para o novo padding e tamanho */
         #${CLOSE_BUTTON_ID} {
            top: 8px;
            right: 8px;
            font-size: 32px; /* Aumenta um pouco o tamanho do '×' para facilitar o toque */
         }
         /* Esconde explicitamente o botão flutuante 'S' e o dropdown quando o overlay estiver aberto */
         /* Embora o overlay já tenha z-index maior, isso garante que não haja interações acidentais */
         #${OVERLAY_ID} ~ #${BUTTON_ID},
         #${OVERLAY_ID} ~ #${DROPDOWN_ID} {
            display: none !important; /* Garante que fiquem escondidos */
         }
         /* Opcional: Posicionar o botão 'S' um pouco mais para dentro em telas pequenas */
         /* #${BUTTON_ID} { bottom: 15px; right: 15px; } */
         /* Opcional: Aumentar um pouco o tamanho do botão 'S' em mobile */
         /* #${BUTTON_ID} { width: 55px; height: 55px; font-size: 26px; } */
      }
    `)
	}

// --- Inicialização ---
	// noinspection JSIgnoredPromiseFromCall
	initialize() // Chama a função principal para iniciar o script assim que ele for carregado

})()
