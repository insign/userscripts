// ==UserScript==
// @name         Summarize with AI
// @namespace    https://github.com/insign/userscripts
// @version      2025.06.19.1411
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

	// --- Constants ---
	// UI Element IDs
	const BUTTON_ID         = 'summarize-button'
	const DROPDOWN_ID       = 'model-dropdown'
	const OVERLAY_ID        = 'summarize-overlay'
	const CLOSE_BUTTON_ID   = 'summarize-close'
	const CONTENT_ID        = 'summarize-content'
	const ERROR_ID          = 'summarize-error'
	const ADD_MODEL_ITEM_ID = 'add-custom-model'
	const RETRY_BUTTON_ID   = 'summarize-retry-button'

	// GM Storage Key for custom models
	const CUSTOM_MODELS_KEY = 'custom_ai_models'

	// Token Limits
	const DEFAULT_MAX_TOKENS = 1000
	const HIGH_MAX_TOKENS    = 1500
	// Long press duration (ms)
	const LONG_PRESS_DURATION = 500

	// Default AI model configurations
	const MODEL_GROUPS = {
		openai: {
			name:    'OpenAI',
			baseUrl: 'https://api.openai.com/v1/chat/completions',
			models:  [
				{ id: 'o4-mini', name: 'o4 mini (better)', params: { max_completion_tokens: HIGH_MAX_TOKENS, reasoning_effort: 'low' } },
				{ id: 'o3-mini', name: 'o3 mini', params: { max_completion_tokens: HIGH_MAX_TOKENS, reasoning_effort: 'low' } },
				{ id: 'gpt-4.1', name: 'GPT-4.1' },
				{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' },
				{ id: 'gpt-4.1-nano', name: 'GPT-4.1 nano (faster)' },
			],
			defaultParams: {max_completion_tokens: DEFAULT_MAX_TOKENS}
		},
		gemini: {
			name:    'Gemini',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/',
			models:  [
				{
					id    : 'gemini-2.5-flash-lite-preview-06-17',
					name  : 'Gemini 2.5 Flash Lite (faster)',
					params: { maxOutputTokens: HIGH_MAX_TOKENS, thinkingConfig: { thinkingBudget: 0 } } // Thinking explicitly disabled
				},
				{
					id    : 'gemini-2.5-flash-preview-04-17',
					name  : 'Gemini 2.5 Flash',
					params: { maxOutputTokens: HIGH_MAX_TOKENS, thinkingConfig: { thinkingBudget: 0 } } // Thinking explicitly disabled
				},
				{
					id    : 'gemini-2.5-pro-preview-05-06',
					name  : 'Gemini 2.5 Pro (better)',
					params: { maxOutputTokens: HIGH_MAX_TOKENS } // No thinkingConfig, Gemini API default (thinking enabled) will be used
				},
			],
			defaultParams: { maxOutputTokens: DEFAULT_MAX_TOKENS } // No default thinkingConfig; handled by model params or custom logic
		},
	}

	// AI Prompt Template
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
		- **Guidelines for Article Quality Assessment (Score 1-10):**
			*   **Clarity and Coherence:** Is the text easy to understand? Is the argumentation logical and does it flow well?
			*   **Depth and Information:** Does the article explore the topic with adequate depth? Does it provide relevant and sufficient information, or is it superficial?
			*   **Structure and Organization:** Is the article well-structured (e.g., clear introduction, developed body, logical conclusion)? Are paragraphs and sections well-organized?
			*   **Engagement and Interest:** Is the article interesting and capable of holding the reader's attention?
			*   **Language and Grammar:** Is the text well-written and free of significant grammatical errors or typos?
		Consider these points comprehensively to form an overall score reflecting the article's quality. Strive for consistency in your assessment regardless of your own advanced reasoning capabilities.

		Example output format:
		<p><strong>Article Quality:</strong> <span class="article-good">8/10</span></p>
		<p>This is a two-sentence introduction to the summary. It provides a brief overview of the main topic.</p>
		<ul>
		<li>emoji; Topic one is discussed here in a clear and concise manner.</li>
		<li>emoji; Topic two follows, explaining another key point from the article.</li>
		<li>emoji; The final bullet point covers the last major idea.</li>
		</ul>
		<p><strong>Opinion:</strong> This is a two-sentence conclusion. It offers a thoughtful perspective based on broader knowledge.</p>

		Here is the content to summarize:
		Article Title: ${title}
		Article Content: ${content}`

	// --- State Variables ---
	let activeModel     = 'gemini-2.5-flash-lite-preview-06-17'
	let articleData     = null
	let customModels    = [] // Stores {id, service, supportsThinking?: boolean}
	let longPressTimer  = null
	let isLongPress     = false
	let modelPressTimer = null

	// --- Main Functions ---

	/**
	 * Initializes the script.
	 */
	async function initialize() {
		customModels = await getCustomModels()
		document.addEventListener('keydown', handleKeyPress)
		articleData = getArticleData()
		if (articleData) {
			addSummarizeButton()
			showElement(BUTTON_ID)
			setupFocusListeners()
			activeModel = await GM.getValue('last_used_model', activeModel)
		}
	}

	/**
	 * Extracts article data using Readability.js.
	 * @returns {object|null} Article data or null.
	 */
	function getArticleData() {
		try {
			const docClone = document.cloneNode(true)
			docClone.querySelectorAll('script, style, noscript, iframe, figure, img, svg, header, footer, nav').forEach(el => el.remove())
			// eslint-disable-next-line no-undef
			if (!isProbablyReaderable(docClone)) {
				console.log('Summarize with AI: Page not detected as readerable.')
				return null
			}
			// eslint-disable-next-line no-undef
			const reader  = new Readability(docClone)
			const article = reader.parse()
			return (article?.content && article.textContent?.trim())
				? { title: article.title, content: article.textContent.trim() }
				: null
		} catch (error) {
			console.error('Summarize with AI: Article parsing failed:', error)
			return null
		}
	}

	/**
	 * Adds the summarize button and dropdown to the DOM.
	 */
	function addSummarizeButton() {
		if (document.getElementById(BUTTON_ID)) return

		const button       = document.createElement('div')
		button.id          = BUTTON_ID
		button.textContent = 'S'
		button.title       = 'Summarize (Alt+S) / Long Press or Tap & Hold to Select Model'
		document.body.appendChild(button)

		const dropdown = createDropdownElement()
		document.body.appendChild(dropdown)
		populateDropdown(dropdown)

		button.addEventListener('click', () => {
			if (!isLongPress) {
				processSummarization()
			}
			isLongPress = false
		})

		const startLongPressTimer = (event) => {
			isLongPress = false
			clearTimeout(longPressTimer)
			longPressTimer = setTimeout(() => {
				isLongPress = true
				toggleDropdown(event)
			}, LONG_PRESS_DURATION)
		}

		const cancelLongPressTimer = () => {
			clearTimeout(longPressTimer)
		}

		button.addEventListener('mousedown', startLongPressTimer)
		button.addEventListener('mouseup', cancelLongPressTimer)
		button.addEventListener('mouseleave', cancelLongPressTimer)
		button.addEventListener('touchstart', startLongPressTimer, { passive: true })
		button.addEventListener('touchend', cancelLongPressTimer)
		button.addEventListener('touchmove', cancelLongPressTimer)
		button.addEventListener('touchcancel', cancelLongPressTimer)

		document.addEventListener('click', handleOutsideClick)
		injectStyles()
	}


	// --- UI Functions (Dropdown, Overlay, Notifications) ---

	/**
	 * Creates the base dropdown element.
	 * @returns {HTMLElement}
	 */
	function createDropdownElement() {
		const dropdown         = document.createElement('div')
		dropdown.id            = DROPDOWN_ID
		dropdown.style.display = 'none'
		return dropdown
	}

	/**
	 * Populates the dropdown with models.
	 * @param {HTMLElement} dropdownElement
	 */
	function populateDropdown(dropdownElement) {
		dropdownElement.innerHTML = ''

		Object.entries(MODEL_GROUPS).forEach(([service, group]) => {
			const standardModels      = group.models || []
			const serviceCustomModels = customModels
				.filter(m => m.service === service)
				.map(m => ({ id: m.id, supportsThinking: m.supportsThinking }))

			const allModelObjects = [...standardModels, ...serviceCustomModels]
				.reduce((acc, model) => {
					if (!acc.some(existing => existing.id.toLowerCase() === model.id.toLowerCase())) {
						acc.push(model)
					}
					return acc
				}, [])
				.sort((a, b) => a.id.localeCompare(b.id))

			if (allModelObjects.length > 0) {
				const groupDiv     = document.createElement('div')
				groupDiv.className = 'model-group'
				groupDiv.appendChild(createHeader(group.name, service))
				allModelObjects.forEach(modelObj => groupDiv.appendChild(createModelItem(modelObj, service)))
				dropdownElement.appendChild(groupDiv)
			}
		})

		const separator           = document.createElement('hr')
		separator.style.margin    = '8px 0'
		separator.style.border    = 'none'
		separator.style.borderTop = '1px solid #eee'
		dropdownElement.appendChild(separator)
		dropdownElement.appendChild(createAddModelItem())
	}

	/**
	 * Creates a header for a model group.
	 * @param {string} text
	 * @param {string} service
	 * @returns {HTMLElement}
	 */
	function createHeader(text, service) {
		const headerContainer     = document.createElement('div')
		headerContainer.className = 'group-header-container'

		const headerText       = document.createElement('span')
		headerText.className   = 'group-header-text'
		headerText.textContent = text

		const resetLink       = document.createElement('a')
		resetLink.href         = '#'
		resetLink.textContent  = 'Reset Key'
		resetLink.className    = 'reset-key-link'
		resetLink.title        = `Reset ${text} API Key`
		resetLink.addEventListener('click', (e) => {
			e.preventDefault()
			e.stopPropagation()
			handleApiKeyReset(service)
		})

		headerContainer.appendChild(headerText)
		headerContainer.appendChild(resetLink)
		return headerContainer
	}

	/**
	 * Creates a model item for the dropdown.
	 * @param {object} modelObj
	 * @param {string} service
	 * @returns {HTMLElement}
	 */
	function createModelItem(modelObj, service) {
		const item       = document.createElement('div')
		item.className   = 'model-item'
		item.textContent = modelObj.name || modelObj.id
		let isModelPress = false

		if (modelObj.id === activeModel) {
			item.style.fontWeight = 'bold'
			item.style.color      = '#1A73E8'
		}

		item.addEventListener('click', () => {
			if (!isModelPress) {
				activeModel = modelObj.id
				GM.setValue('last_used_model', activeModel)
				hideElement(DROPDOWN_ID)
				processSummarization()
			}
			isModelPress = false
		})

		const isCustom = !MODEL_GROUPS[service]?.models.some(m => m.id === modelObj.id)

		if (isCustom) {
			item.title = 'Click to use. Long press to delete.'

			const startModelPressTimer = (e) => {
				e.stopPropagation()
				isModelPress = false
				clearTimeout(modelPressTimer)
				modelPressTimer = setTimeout(() => {
					isModelPress = true
					handleModelRemoval(modelObj.id, service)
				}, LONG_PRESS_DURATION)
			}

			const cancelModelPressTimer = (e) => {
				e.stopPropagation()
				clearTimeout(modelPressTimer)
			}

			item.addEventListener('mousedown', startModelPressTimer)
			item.addEventListener('mouseup', cancelModelPressTimer)
			item.addEventListener('mouseleave', cancelModelPressTimer)
			item.addEventListener('touchstart', startModelPressTimer, { passive: true })
			item.addEventListener('touchend', cancelModelPressTimer)
			item.addEventListener('touchmove', cancelModelPressTimer)
			item.addEventListener('touchcancel', cancelModelPressTimer)
		}
		else {
			item.title = 'Click to use this model.'
		}
		return item
	}


	/**
	 * Creates the "Add Custom Model" item.
	 * @returns {HTMLElement}
	 */
	function createAddModelItem() {
		const item       = document.createElement('div')
		item.id          = ADD_MODEL_ITEM_ID
		item.className   = 'model-item add-model-item'
		item.textContent = '+ Add Custom Model'
		item.addEventListener('click', async (e) => {
			e.stopPropagation()
			hideElement(DROPDOWN_ID)
			await handleAddModel()
		})
		return item
	}

	/**
	 * Toggles dropdown visibility.
	 * @param {Event} [e]
	 */
	function toggleDropdown(e) {
		if (e) e.stopPropagation()
		const dropdown = document.getElementById(DROPDOWN_ID)
		if (dropdown) {
			const isHidden = dropdown.style.display === 'none'
			if (isHidden) {
				populateDropdown(dropdown)
				showElement(DROPDOWN_ID)
			} else {
				hideElement(DROPDOWN_ID)
			}
		}
	}

	/**
	 * Handles clicks outside the dropdown to close it.
	 * @param {Event} event
	 */
	function handleOutsideClick(event) {
		const dropdown = document.getElementById(DROPDOWN_ID)
		const button   = document.getElementById(BUTTON_ID)
		if (dropdown && dropdown.style.display !== 'none' &&
			!dropdown.contains(event.target) &&
			!button?.contains(event.target)) {
			hideElement(DROPDOWN_ID)
		}
	}

	/**
	 * Shows the summary overlay.
	 * @param {string} contentHTML
	 * @param {boolean} [isError=false]
	 */
	function showSummaryOverlay(contentHTML, isError = false) {
		if (document.getElementById(OVERLAY_ID)) {
			updateSummaryOverlay(contentHTML, isError)
			return
		}

		const overlay    = document.createElement('div')
		overlay.id = OVERLAY_ID

		let finalContentHTML = `<div id="${CLOSE_BUTTON_ID}" title="Close (Esc)">×</div>${contentHTML}`
		if (isError) {
			finalContentHTML += `<button id="${RETRY_BUTTON_ID}" class="retry-button">Try Again</button>`
		}
		overlay.innerHTML = `<div id="${CONTENT_ID}">${finalContentHTML}</div>`

		document.body.appendChild(overlay)
		document.body.style.overflow = 'hidden'

		document.getElementById(CLOSE_BUTTON_ID).addEventListener('click', closeOverlay)
		overlay.addEventListener('click', e => e.target === overlay && closeOverlay())
		document.getElementById(RETRY_BUTTON_ID)?.addEventListener('click', processSummarization)
	}

	/**
	 * Closes the summary overlay.
	 */
	function closeOverlay() {
		const overlay = document.getElementById(OVERLAY_ID)
		if (overlay) {
			overlay.remove()
			document.body.style.overflow = ''
		}
	}

	/**
	 * Updates existing summary overlay content.
	 * @param {string} contentHTML
	 * @param {boolean} [isError=false]
	 */
	function updateSummaryOverlay(contentHTML, isError = false) {
		const contentDiv = document.getElementById(CONTENT_ID)
		if (contentDiv) {
			let finalContentHTML = `<div id="${CLOSE_BUTTON_ID}" title="Close (Esc)">×</div>${contentHTML}`
			if (isError) {
				finalContentHTML += `<button id="${RETRY_BUTTON_ID}" class="retry-button">Try Again</button>`
			}
			contentDiv.innerHTML = finalContentHTML

			document.getElementById(CLOSE_BUTTON_ID)?.addEventListener('click', closeOverlay)
			document.getElementById(RETRY_BUTTON_ID)?.addEventListener('click', processSummarization)
		}
	}

	/**
	 * Shows a temporary error notification.
	 * @param {string} message
	 */
	function showErrorNotification(message) {
		document.getElementById(ERROR_ID)?.remove()

		const errorDiv     = document.createElement('div')
		errorDiv.id        = ERROR_ID
		errorDiv.innerText = message
		document.body.appendChild(errorDiv)

		setTimeout(() => errorDiv.remove(), 4000)
	}

	/**
	 * Hides an element.
	 * @param {string} id
	 */
	function hideElement(id) {
		const el = document.getElementById(id)
		if (el) el.style.display = 'none'
	}

	/**
	 * Shows an element.
	 * @param {string} id
	 */
	function showElement(id) {
		const el = document.getElementById(id)
		if (el) {
			el.style.display = (id === BUTTON_ID) ? 'flex' : 'block'
		}
	}

	// --- Logic Functions (Summarization, API, Models) ---

	/**
	 * Gets the active model's configuration.
	 * @returns {object|null}
	 */
	function getActiveModelConfig() {
		for (const serviceKey in MODEL_GROUPS) {
			const group = MODEL_GROUPS[serviceKey]
			const modelConfig = group.models.find(m => m.id === activeModel)
			if (modelConfig) {
				return { ...modelConfig, service: serviceKey, isCustom: false }
			}
		}
		// For custom models, `service` and `supportsThinking` are part of the customConfig object itself
		const customConfig = customModels.find(m => m.id === activeModel)
		if (customConfig) {
			return { ...customConfig, isCustom: true } // `params` will be undefined for custom models for now
		}
		console.error(`Summarize with AI: Active model configuration not found for ID: ${activeModel}`)
		return null
	}


	/**
	 * Orchestrates the summarization process.
	 */
	async function processSummarization() {
		try {
			if (!articleData) {
				showErrorNotification('Article content not found or not readable.')
				return
			}

			const modelConfig = getActiveModelConfig()
			if (!modelConfig) {
				showErrorNotification(`Configuration for model "${activeModel}" not found. Please select another model.`)
				return
			}

			const modelDisplayName = modelConfig.name || modelConfig.id
			const service = modelConfig.service

			const apiKey = await getApiKey(service)
			if (!apiKey) {
				const errorMsg = `API key for ${service.toUpperCase()} is required. Click the 'Reset Key' link in the model selection menu (long-press 'S' button).`
				if (document.getElementById(OVERLAY_ID)) {
					updateSummaryOverlay(`<p style="color: red;">${errorMsg}</p>`, false)
				} else {
					showErrorNotification(errorMsg)
				}
				return
			}

			const loadingMessage = `<p class="glow">Summarizing with ${modelDisplayName}... </p>`
			if (document.getElementById(OVERLAY_ID)) {
				updateSummaryOverlay(loadingMessage)
			} else {
				showSummaryOverlay(loadingMessage)
			}

			const payload = { title: articleData.title, content: articleData.content, lang: navigator.language || 'en-US' }
			const response = await sendApiRequest(service, apiKey, payload, modelConfig)

			handleApiResponse(response, service)

		} catch (error) {
			const errorMsg = `Error: ${error.message}`
			console.error('Summarize with AI:', errorMsg, error)
			showSummaryOverlay(`<p style="color: red;">${errorMsg}</p>`, true)
			hideElement(DROPDOWN_ID)
		}
	}

	/**
	 * Sends API request.
	 * @param {string} service
	 * @param {string} apiKey
	 * @param {object} payload
	 * @param {object} modelConfig
	 * @returns {Promise<object>}
	 */
	async function sendApiRequest(service, apiKey, payload, modelConfig) {
		const group = MODEL_GROUPS[service]
		const url   = service === 'openai'
			? group.baseUrl
			: `${group.baseUrl}${modelConfig.id}:generateContent?key=${apiKey}`

		return new Promise((resolve, reject) => {
			GM.xmlHttpRequest({
				method      : 'POST',
				url         : url,
				headers     : getHeaders(service, apiKey),
				data:         JSON.stringify(buildRequestBody(service, payload, modelConfig)),
				responseType: 'json',
				timeout     : 60000,
				onload:       response => {
					const responseData = response.response || response.responseText
					resolve({
						status: response.status,
						data:       typeof responseData === 'object' ? responseData : JSON.parse(responseData || '{}'),
						statusText: response.statusText,
					})
				},
				onerror     : error => reject(new Error(`Network error: ${error.statusText || 'Failed to connect'}`)),
				onabort     : () => reject(new Error('Request aborted')),
				ontimeout   : () => reject(new Error('Request timed out after 60 seconds')),
			})
		})
	}

	/**
	 * Handles API response.
	 * @param {object} response
	 * @param {string} service
	 * @throws {Error}
	 */
	function handleApiResponse(response, service) {
		const { status, data, statusText } = response

		if (status < 200 || status >= 300) {
			const errorDetails = data?.error?.message || data?.message || statusText || 'Unknown API error'
			throw new Error(`API Error (${status}): ${errorDetails}`)
		}

		let rawSummary = ''
		if (service === 'openai') {
			const choice = data?.choices?.[0]
			rawSummary   = choice?.message?.content
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

			if (candidate?.content?.parts?.length > 0 && candidate.content.parts[0].text) {
				rawSummary = candidate.content.parts[0].text
			} else if (finishReason && !['STOP', 'SAFETY', 'MAX_TOKENS'].includes(finishReason)) {
				console.warn(`Summarize with AI: Gemini response structure missing expected text content or unusual finish reason: ${finishReason}`, candidate)
			}
			else if (!rawSummary && !data?.error) {
				console.warn('Summarize with AI: Gemini response structure missing expected text content.', candidate)
			}
		}

		if (!rawSummary && !data?.error) {
			console.error('Summarize with AI: API Response Data:', data)
			throw new Error('API response did not contain a valid summary.')
		}

		const cleanedSummary = rawSummary.replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim()
		updateSummaryOverlay(cleanedSummary, false)
	}

	/**
	 * Builds the request body for API call.
	 * @param {string} service
	 * @param {object} payload
	 * @param {object} modelConfig
	 * @returns {object}
	 */
	function buildRequestBody(service, {title, content, lang}, modelConfig) {
		const systemPrompt = PROMPT_TEMPLATE(title, content, lang)

		if (service === 'openai') {
			const serviceDefaults     = MODEL_GROUPS.openai.defaultParams || {}
			const modelSpecificParams = modelConfig.params || {} // For custom models, this will be undefined/empty from getActiveModelConfig
			const finalParams         = { ...serviceDefaults, ...modelSpecificParams }

			return {
				model   : modelConfig.id,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: 'Generate the summary as requested.' }
				],
				...finalParams
			}
		} else { // gemini
			const geminiDefaults        = MODEL_GROUPS.gemini.defaultParams || {}
			const modelParamsFromConfig = modelConfig.params || {} // For standard models from MODEL_GROUPS
			// For custom models, modelConfig.params is undefined from getActiveModelConfig
			let finalGenerationConfig = { ...geminiDefaults, ...modelParamsFromConfig }

			if (modelConfig.isCustom) {
				// For custom Gemini models, modelConfig.params from getActiveModelConfig is undefined.
				// We rely on modelConfig.supportsThinking.
				if (modelConfig.supportsThinking === true) {
					// If user indicated it supports thinking, we want Gemini API's default behavior for thinking.
					// So, remove any thinkingConfig that might have been inherited (e.g., if geminiDefaults had one, which it shouldn't).
					delete finalGenerationConfig.thinkingConfig
				}
				else { // supportsThinking is false or undefined (treat undefined as false for safety for older custom models)
					// Explicitly disable thinking if not supported or unknown for custom model.
					finalGenerationConfig.thinkingConfig = { thinkingBudget: 0 }
				}
			}
			// For standard Gemini models, their 'params' in MODEL_GROUPS (already merged into finalGenerationConfig via modelParamsFromConfig)
			// will dictate thinkingConfig. If a standard model has no thinkingConfig in its params,
			// and geminiDefaults also has no thinkingConfig (which is the new setup),
			// then no thinkingConfig is sent, and Gemini API uses its own default (thinking enabled for 2.5 Pro, potentially others).

			return {
				contents        : [ { parts: [ { text: systemPrompt } ] } ],
				generationConfig: finalGenerationConfig
			}
		}
	}

	/**
	 * Returns HTTP headers.
	 * @param {string} service
	 * @param {string} apiKey
	 * @returns {object}
	 */
	function getHeaders(service, apiKey) {
		const headers = {'Content-Type': 'application/json'}
		if (service === 'openai') {
			headers['Authorization'] = `Bearer ${apiKey}`
		}
		return headers
	}

	/**
	 * Retrieves API key for a service.
	 * @param {string} service
	 * @returns {Promise<string|null>}
	 */
	async function getApiKey(service) {
		const storageKey = `${service}_api_key`
		let apiKey       = await GM.getValue(storageKey)
		return apiKey?.trim() || null
	}

	/**
	 * Handles API key reset for a service.
	 * @param {string} service
	 */
	async function handleApiKeyReset(service) {
		if (!service || !MODEL_GROUPS[service]) {
			console.error("Invalid service provided for API key reset:", service)
			alert("Internal error: Invalid service provided.")
			return
		}
		const storageKey = `${service}_api_key`
		const newKey     = prompt(`Enter the new ${service.toUpperCase()} API key (leave blank to clear):`)

		if (newKey !== null) {
			const keyToSave = newKey.trim()
			await GM.setValue(storageKey, keyToSave)
			if (keyToSave) {
				alert(`${service.toUpperCase()} API key updated!`)
			} else {
				alert(`${service.toUpperCase()} API key cleared!`)
			}
		}
	}

	/**
	 * Handles adding a new custom model.
	 */
	async function handleAddModel() {
		const service = prompt('Enter the service for the custom model (openai / gemini):')?.toLowerCase()?.trim()
		if (!service || !MODEL_GROUPS[service]) {
			if (service !== null) alert('Invalid service. Please enter "openai" or "gemini".')
			return
		}

		const modelId = prompt(`Enter the exact ID of the ${service.toUpperCase()} model:`)?.trim()
		if (!modelId) {
			if (modelId !== null) alert('Model ID cannot be empty.')
			return
		}

		let supportsThinking = undefined // Stays undefined for OpenAI or if user cancels for Gemini
		if (service === 'gemini') {
			const thinkingInput = prompt(`Does this custom Gemini model ("${modelId}") support 'thinking' (e.g., gemini-2.5-pro)? (yes/no):`)?.toLowerCase()?.trim()
			if (thinkingInput === null) return // User cancelled prompt
			if (![ 'yes', 'no' ].includes(thinkingInput)) {
				alert('Invalid input for thinking support. Please enter "yes" or "no".')
				return
			}
			supportsThinking = (thinkingInput === 'yes')
		}

		await addCustomModel(service, modelId, supportsThinking)
	}

	/**
	 * Adds a custom model.
	 * @param {string} service
	 * @param {string} modelId
	 * @param {boolean|undefined} supportsThinking - Undefined if not Gemini or if not applicable.
	 */
	async function addCustomModel(service, modelId, supportsThinking) {
		const existsInCustom   = customModels.some(m => m.service === service && m.id.toLowerCase() === modelId.toLowerCase())
		const existsInStandard = MODEL_GROUPS[service]?.models.some(m => m.id.toLowerCase() === modelId.toLowerCase())

		if (existsInCustom || existsInStandard) {
			alert(`Model ID "${modelId}" already exists for ${service.toUpperCase()}.`)
			return
		}

		const newModel = { id: modelId, service }
		if (service === 'gemini' && typeof supportsThinking === 'boolean') {
			newModel.supportsThinking = supportsThinking
		}

		customModels.push(newModel)
		await GM.setValue(CUSTOM_MODELS_KEY, JSON.stringify(customModels))
		alert(`Custom model "${modelId}" (${service.toUpperCase()}) added!`)
	}

	/**
	 * Handles removal of a custom model.
	 * @param {string} modelId
	 * @param {string} service
	 */
	async function handleModelRemoval(modelId, service) {
		// eslint-disable-next-line no-restricted-globals
		const confirmed = confirm(`Are you sure you want to delete the custom model "${modelId}"?`)
		if (confirmed) {
			customModels = customModels.filter(m => !(m.id.toLowerCase() === modelId.toLowerCase() && m.service === service))
			await GM.setValue(CUSTOM_MODELS_KEY, JSON.stringify(customModels))

			if (activeModel === modelId) {
				activeModel = 'gemini-2.5-flash-lite-preview-06-17'
				await GM.setValue('last_used_model', activeModel)
			}

			const dropdown = document.getElementById(DROPDOWN_ID)
			if (dropdown && dropdown.style.display !== 'none') {
				populateDropdown(dropdown)
			}
			alert(`Model "${modelId}" has been removed.`)
		}
	}


	/**
	 * Loads custom models from storage.
	 * @returns {Promise<Array<object>>}
	 */
	async function getCustomModels() {
		try {
			const storedModels = await GM.getValue(CUSTOM_MODELS_KEY, '[]')
			const parsedModels = JSON.parse(storedModels)
			if (Array.isArray(parsedModels) && parsedModels.every(m =>
				typeof m === 'object' && m.id && m.service &&
				(m.service !== 'gemini' || typeof m.supportsThinking === 'boolean' || typeof m.supportsThinking === 'undefined') // Check supportsThinking validity
			)) {
				return parsedModels
			} else {
				console.warn("Summarize with AI: Invalid custom model format found in storage. Resetting.", parsedModels)
				await GM.setValue(CUSTOM_MODELS_KEY, '[]')
				return []
			}
		} catch (error) {
			console.error('Summarize with AI: Failed to load/parse custom models:', error)
			await GM.setValue(CUSTOM_MODELS_KEY, '[]')
			return []
		}
	}

	// --- Event Handlers & Utilities ---

	/**
	 * Handles key press events.
	 * @param {KeyboardEvent} e
	 */
	function handleKeyPress(e) {
		if (e.altKey && e.code === 'KeyS' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
			e.preventDefault()
			const button = document.getElementById(BUTTON_ID)
			if (button) {
				if (!document.activeElement?.closest('input, textarea, select, [contenteditable="true"]')) {
					processSummarization()
				}
			}
		}
		if (e.key === 'Escape') {
			if (document.getElementById(OVERLAY_ID)) {
				e.preventDefault()
				closeOverlay()
			}
			else if (document.getElementById(DROPDOWN_ID)?.style.display !== 'none') {
				e.preventDefault()
				hideElement(DROPDOWN_ID)
			}
		}
	}

	/**
	 * Sets up focus listeners to hide/show button.
	 */
	function setupFocusListeners() {
		document.addEventListener('focusin', (event) => {
			if (event.target?.closest('input, textarea, select, [contenteditable="true"]')) {
				hideElement(BUTTON_ID)
				hideElement(DROPDOWN_ID)
			}
		})

		document.addEventListener('focusout', (event) => {
			const isLeavingInput  = event.target?.closest('input, textarea, select, [contenteditable="true"]')
			const isEnteringInput = event.relatedTarget?.closest('input, textarea, select, [contenteditable="true"]')

			if (isLeavingInput && !isEnteringInput && articleData) {
				setTimeout(() => {
					if (!document.activeElement?.closest('input, textarea, select, [contenteditable="true"]')) {
						showElement(BUTTON_ID)
					}
				}, 50)
			}
		}, true)
	}

	/**
	 * Injects CSS styles.
	 */
	function injectStyles() {
		GM.addStyle(`
      /* --- Main UI Elements --- */
      #${BUTTON_ID} {
        position: fixed; bottom: 20px; right: 20px;
        width: 50px; height: 50px;
        background: linear-gradient(145deg, #3a7bd5, #00d2ff);
        color: white; font-size: 24px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        border-radius: 50%; cursor: pointer; z-index: 2147483640;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        display: flex !important; align-items: center !important; justify-content: center !important;
        transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
        line-height: 1; user-select: none;
        -webkit-tap-highlight-color: transparent;
      }
      #${BUTTON_ID}:hover {
        transform: scale(1.1); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
      }
      #${DROPDOWN_ID} {
        position: fixed; bottom: 80px; right: 20px;
        background: #ffffff; border: 1px solid #e0e0e0; border-radius: 10px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15); z-index: 2147483641;
        max-height: 70vh; overflow-y: auto;
        padding: 8px; width: 300px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        display: none;
        animation: fadeIn 0.2s ease-out;
      }
      #${OVERLAY_ID} {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(0, 0, 0, 0.6);
        z-index: 2147483645;
        display: flex; align-items: center; justify-content: center;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        animation: fadeIn 0.3s ease-out;
      }
      #${CONTENT_ID} {
        background-color: #fff;
        color: #333;
        padding: 25px 35px; border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        max-width: 800px; width: 90%; max-height: 85vh;
        overflow-y: auto;
        position: relative;
        font-size: 16px; line-height: 1.6;
        animation: slideInUp 0.3s ease-out;
        white-space: normal;
        box-sizing: border-box;
      }
      #${CONTENT_ID} p { margin-top: 0; margin-bottom: 1em; }
      #${CONTENT_ID} ul { margin: 1em 0; padding-left: 1.5em; }
      #${CONTENT_ID} li { list-style-type: none; margin-bottom: 0.5em; }
      #${CLOSE_BUTTON_ID} {
        position: absolute; top: 15px; right: 20px;
        font-size: 28px; color: #aaa;
        cursor: pointer;
        transition: color 0.2s; line-height: 1; z-index: 1;
      }
      #${CLOSE_BUTTON_ID}:hover { color: #333; }
      #${ERROR_ID} {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background-color: #e53e3e; color: white; padding: 12px 20px;
        border-radius: 6px; z-index: 2147483646;
        font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        animation: fadeIn 0.3s, fadeOut 0.3s 3.7s forwards;
      }
      .retry-button {
        display: block; margin: 20px auto 0; padding: 8px 16px;
        background-color: #4a90e2;
        color: white; border: none; border-radius: 5px;
        cursor: pointer; font-size: 14px; transition: background-color 0.2s;
      }
      .retry-button:hover { background-color: #3a7bd5; }

      /* --- Dropdown Styles --- */
      .model-group { margin-bottom: 8px; }
      .group-header-container {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; background: #f7f7f7;
        border-radius: 6px; margin-bottom: 4px;
      }
      .group-header-text {
        font-weight: 600; color: #333; font-size: 13px;
        text-transform: uppercase; letter-spacing: 0.5px;
        flex-grow: 1;
      }
      .reset-key-link {
        font-size: 11px; color: #666; text-decoration: none;
        margin-left: 10px;
        white-space: nowrap;
        cursor: pointer;
        transition: color 0.2s;
      }
      .reset-key-link:hover { color: #1a73e8; }
      .model-item {
        padding: 10px 14px; margin: 2px 0; border-radius: 6px;
        transition: background-color 0.15s ease-out, color 0.15s ease-out;
        font-size: 14px; cursor: pointer; color: #444; display: block;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .model-item:hover { background-color: #eef6ff; color: #1a73e8; }
      .add-model-item {
         color: #666;
         font-style: italic;
      }
      .add-model-item:hover { background-color: #f0f0f0; color: #333; }

      /* --- Content Styles (Glow, Article Quality) --- */
      .glow {
        font-size: 1.4em; text-align: center; padding: 40px 0;
        animation: glow 2.5s ease-in-out infinite;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-weight: 400;
      }
      span.article-excellent { color: #2ecc71; font-weight: bold; }
      span.article-good      { color: #3498db; font-weight: bold; }
      span.article-average   { color: #f39c12; font-weight: bold; }
      span.article-bad       { color: #e74c3c; font-weight: bold; }
      span.article-very-bad  { color: #c0392b; font-weight: bold; }

      /* --- Animations --- */
      @keyframes glow {
        0%, 100% { color: #4a90e2; text-shadow: 0 0 10px rgba(74, 144, 226, 0.6), 0 0 20px rgba(74, 144, 226, 0.4); }
        33%      { color: #9b59b6; text-shadow: 0 0 12px rgba(155, 89, 182, 0.7), 0 0 25px rgba(155, 89, 182, 0.5); }
        66%      { color: #e74c3c; text-shadow: 0 0 12px rgba(231, 76, 60, 0.7), 0 0 25px rgba(231, 76, 60, 0.5); }
      }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
      @keyframes slideInUp {
         from { transform: translateY(30px); opacity: 0; }
         to { transform: translateY(0); opacity: 1; }
      }

      /* --- Dark Mode Override --- */
      @media (prefers-color-scheme: dark) {
        #${OVERLAY_ID} {
          background-color: rgba(20, 20, 20, 0.7);
        }
        #${CONTENT_ID} {
          background-color: #2c2c2c;
          color: #e0e0e0;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
        }
        #${CLOSE_BUTTON_ID} { color: #888; }
        #${CLOSE_BUTTON_ID}:hover { color: #eee; }
        .retry-button { background-color: #555; color: #eee; }
        .retry-button:hover { background-color: #666; }
        #${DROPDOWN_ID} { background: #333; border-color: #555; }
        .model-item { color: #ccc; }
        .model-item:hover { background-color: #444; color: #fff; }
        .group-header-container { background: #444; }
        .group-header-text { color: #eee; }
        .reset-key-link { color: #aaa; }
        .reset-key-link:hover { color: #fff; }
        .add-model-item { color: #999; }
        .add-model-item:hover { background-color: #4a4a4a; color: #eee; }
        hr { border-top-color: #555 !important; }
      }

      /* --- Mobile Responsiveness --- */
      @media (max-width: 600px) {
         #${CONTENT_ID} {
            width: 100%; height: 100%;
            max-width: none; max-height: none;
            border-radius: 0; padding: 20px 15px;
            box-shadow: none; animation: none; font-size: 15px;
         }
         #${CLOSE_BUTTON_ID} { top: 15px; right: 15px; font-size: 32px; }
         #${OVERLAY_ID} ~ #${BUTTON_ID},
         #${OVERLAY_ID} ~ #${DROPDOWN_ID} { display: none !important; }
      }
    `)
	}

	// --- Initialization ---
	// noinspection JSIgnoredPromiseFromCall
	initialize()

})()