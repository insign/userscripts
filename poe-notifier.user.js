// ==UserScript==
// @name         Poe Notifier
// @namespace    https://github.com/insign/userscripts
// @version      1.3
// @description  Monitors poe.com for "Waiting...", changes favicon to orange, notifies when done, and restores original favicon on tab focus (if not waiting).
// @author       Hélio <open@helio.me>
// @license      WTFPL
// @match        *://poe.com/*
// @run-at       document-idle
// @icon         https://poe.com/favicon.ico
// @grant        GM_notification
// @downloadURL  https://update.greasyfork.org/scripts/509193/Poe%20Notifier.user.js
// @updateURL    https://update.greasyfork.org/scripts/509193/Poe%20Notifier.meta.js
// ==/UserScript==

(function() {
	'use strict'

	// --- Configurações ---

	// URL do ícone de círculo laranja (SVG embutido como Data URI para independência)
	// Um círculo laranja simples para indicar processamento ou conclusão recente.
	const ORANGE_ICON_URL = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2245%22 fill=%22orange%22 stroke=%22darkorange%22 stroke-width=%223%22/></svg>`
	// Texto que indica que o Poe está processando a solicitação.
	// Usar regex para flexibilidade (ignora case e espaços extras)
	const WAITING_REGEX = /waiting\.\.\./i

	// --- Variáveis Globais ---

	// Armazena a URL original do favicon para restauração posterior.
	let originalFaviconUrl = ''
	// Referência ao elemento <link> do favicon no <head> da página.
	let faviconLinkElement = null
	// Flag para rastrear se a mensagem "Waiting..." está atualmente visível na página.
	// true = "Waiting..." está visível; false = "Waiting..." não está visível.
	let isCurrentlyWaiting = false
	// Guarda o ID do timer para debounce da checagem (evita checagens excessivas em mutações rápidas)
	let checkDebounceTimer = null
	// Guarda o ID do timer para debounce da notificação (evita múltiplas notificações se o estado oscilar rapidamente)
	let notificationDebounceTimer = null


	// --- Funções Auxiliares ---

	/**
	 * Encontra ou cria o elemento <link> do favicon e armazena sua URL original.
	 * Garante que `faviconLinkElement` e `originalFaviconUrl` estejam definidos.
	 */
	function findOrCreateFavicon() {
		// Tenta encontrar o link do ícone existente na página
		faviconLinkElement = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]')

		if (faviconLinkElement) {
			// Se um link de ícone foi encontrado, guarda sua URL original
			originalFaviconUrl = faviconLinkElement.href
			console.log('Poe Notifier: Original favicon found:', originalFaviconUrl)
		} else {
			// Se nenhum link de ícone foi encontrado, cria um elemento <link> dinamicamente
			console.warn('Poe Notifier: No favicon link found, creating one.')
			faviconLinkElement = document.createElement('link')
			faviconLinkElement.rel = 'icon'
			// Define um valor padrão comum como fallback. Poe.com *tem* um favicon, então isso é mais uma segurança.
			originalFaviconUrl = '/favicon.ico'
			faviconLinkElement.href = originalFaviconUrl
			// Adiciona o novo elemento <link> ao <head> do documento
			;(document.head || document.documentElement).appendChild(faviconLinkElement)
		}
	}

	/**
	 * Altera o ícone (favicon) da página para a URL fornecida.
	 * @param {string} newIconUrl - A URL do novo ícone a ser definido no atributo href do elemento link.
	 */
	function changeFavicon(newIconUrl) {
		if (!faviconLinkElement) {
			console.error('Poe Notifier: Favicon link element not available.')
			findOrCreateFavicon() // Tenta encontrar/criar novamente em caso de erro
			if (!faviconLinkElement) return // Aborta se ainda não conseguiu
		}
		// Só altera se a URL for diferente da atual, evitando re-renderizações desnecessárias
		if (faviconLinkElement.href !== newIconUrl) {
			faviconLinkElement.href = newIconUrl
			// console.log('Poe Notifier: Favicon changed to:', newIconUrl);
		}
	}

	/**
	 * Envia uma notificação ao usuário informando que o Poe terminou.
	 * Usa GM_notification para melhor integração com gerenciadores de script.
	 */
	function sendPoeNotification() {
		// Usa debounce para evitar notificações múltiplas em rápida sucessão
		clearTimeout(notificationDebounceTimer)
		notificationDebounceTimer = setTimeout(() => {
			console.log('Poe Notifier: Sending notification.')
			try {
				GM_notification({
					title: 'Poe Notifier',
					text: 'Poe has finished processing!',
					image: ORANGE_ICON_URL, // Usa o ícone laranja na notificação
					highlight: false, // Não acende a tela
					silent: false,    // Toca som padrão (se configurado no sistema/gerenciador)
					timeout: 5000,    // Fecha automaticamente após 5 segundos
					// onclick: () => { window.focus(); } // Foca a janela ao clicar (opcional)
				})
			} catch (e) {
				console.error("Poe Notifier: Failed to send GM_notification.", e)
				// Fallback para Notification API se GM_notification falhar (requer permissão)
				if (Notification.permission === 'granted') {
					new Notification('Poe.com Finished!', { body: 'Processing complete.', icon: ORANGE_ICON_URL });
				} else if (Notification.permission !== 'denied') {
					Notification.requestPermission().then(perm => {
						if (perm === 'granted') {
							new Notification('Poe.com Finished!', { body: 'Processing complete.', icon: ORANGE_ICON_URL });
						}
					});
				}
			}
		}, 300) // Atraso de 300ms para debounce da notificação
	}

	/**
	 * Verifica a presença do texto "Waiting..." no corpo do documento.
	 * Atualiza o estado `isCurrentlyWaiting`, muda o favicon e agenda notificação.
	 * Esta função é chamada com debounce pelo MutationObserver.
	 */
	function checkWaitingStatus() {
		// Verifica se o regex WAITING_REGEX corresponde a algum texto no corpo da página
		const isWaitingNow = WAITING_REGEX.test(document.body.textContent)

		if (isWaitingNow && !isCurrentlyWaiting) {
			// Mudança de estado: Não esperando -> Esperando
			console.log('Poe Notifier: Detected "Waiting...". Changing favicon to orange.')
			isCurrentlyWaiting = true          // Atualiza o estado global
			changeFavicon(ORANGE_ICON_URL)     // Muda o favicon para o ícone laranja
			clearTimeout(notificationDebounceTimer) // Cancela qualquer notificação pendente
		} else if (!isWaitingNow && isCurrentlyWaiting) {
			// Mudança de estado: Esperando -> Não esperando
			console.log('Poe Notifier: "Waiting..." disappeared. Keeping orange favicon and scheduling notification.')
			isCurrentlyWaiting = false          // Atualiza o estado global
			// Mantém o favicon laranja para indicar que a tarefa acabou de terminar
			changeFavicon(ORANGE_ICON_URL)
			// Agenda o envio da notificação para alertar o usuário (com debounce)
			sendPoeNotification()
			// Nota: O favicon só será restaurado para o original quando a aba receber foco.
		}
		// Nenhuma ação se o estado não mudou.
	}

	/**
	 * Função com debounce para chamar checkWaitingStatus.
	 * Evita execuções múltiplas e muito rápidas em resposta a mutações no DOM.
	 */
	function debouncedCheckWaitingStatus() {
		clearTimeout(checkDebounceTimer) // Cancela o timer anterior
		// Agenda uma nova execução após um curto período (ex: 250ms)
		checkDebounceTimer = setTimeout(checkWaitingStatus, 250)
	}


	/**
	 * Restaura o favicon original da página QUANDO a aba ganha foco,
	 * mas SOMENTE SE o estado atual NÃO for mais de espera (`isCurrentlyWaiting` for false).
	 */
	function restoreOriginalFaviconOnFocus() {
		// Garante que temos a referência ao favicon e a URL original
		if (!faviconLinkElement || !originalFaviconUrl) {
			console.warn('Poe Notifier: Trying to restore favicon on focus, but references are missing.')
			findOrCreateFavicon() // Tenta obter as referências novamente
			if (!faviconLinkElement || !originalFaviconUrl) return // Aborta se ainda falhar
		}

		// Verifica se o script NÃO está no estado de "esperando"
		if (!isCurrentlyWaiting) {
			// Restaura o favicon original apenas se ele não for o atual
			if (faviconLinkElement.href !== originalFaviconUrl) {
				console.log('Poe Notifier: Tab focused and not waiting. Restoring original favicon.')
				changeFavicon(originalFaviconUrl)
			} else {
				// console.log('Poe Notifier: Tab focused, not waiting, favicon already original.');
			}
		} else {
			// Se ainda estiver esperando ("Waiting..." visível), garante que o ícone laranja permaneça.
			// console.log('Poe Notifier: Tab focused, but still waiting. Keeping orange icon.');
			changeFavicon(ORANGE_ICON_URL) // Garante que esteja laranja
		}
	}

	// --- Inicialização do Script ---

	console.log('Poe Notifier: Script starting...')

	// 1. Garante que o elemento do favicon e sua URL original sejam encontrados/criados.
	findOrCreateFavicon()

	// 2. Adiciona um event listener para o evento 'focus' da janela.
	// Quando o usuário retorna para esta aba, `restoreOriginalFaviconOnFocus` será chamada.
	window.addEventListener('focus', restoreOriginalFaviconOnFocus)

	// 3. Configura um MutationObserver para monitorar mudanças no DOM de forma eficiente.
	// Observará o `document.body` e seus descendentes por mudanças no texto e na estrutura.
	const observer = new MutationObserver(mutations => {
		// Em vez de analisar cada mutação, simplesmente chamamos a função de checagem
		// com debounce sempre que qualquer mutação relevante ocorrer no body ou seus filhos.
		// Verifica se houve mudança de texto (characterData) ou adição/remoção de nós (childList)
		const relevantMutation = mutations.some(m => m.type === 'characterData' || m.type === 'childList');
		if (relevantMutation) {
			debouncedCheckWaitingStatus()
		}
	})

	// 4. Inicia a observação do `document.body`.
	//    Observa mudanças nos dados de caracteres (texto) e na lista de filhos (adição/remoção).
	//    `subtree: true` garante que mudanças em qualquer lugar dentro do body sejam capturadas.
	observer.observe(document.body, {
		childList: true,
		subtree: true,
		characterData: true // Crucial para detectar a mudança do texto "Waiting..."
	})

	// 5. Executa uma verificação inicial do estado "Waiting..." imediatamente.
	// Importante caso a página já carregue com "Waiting..." visível.
	console.log('Poe Notifier: Performing initial status check.')
	checkWaitingStatus()

	// 6. Verifica permissão de notificação (apenas para log informativo, já que usamos GM_notification)
	if (typeof Notification !== 'undefined') { // Verifica se a API Notification existe
		console.log('Poe Notifier: Browser Notification permission status:', Notification.permission)
		if (Notification.permission === 'default') {
			console.log('Poe Notifier: Browser notifications permission not yet requested.')
			// Poderia solicitar aqui, mas GM_notification é preferível.
			// Notification.requestPermission();
		}
	} else {
		console.log('Poe Notifier: Browser Notification API not available.')
	}


	console.log('Poe Notifier: Script initialized and monitoring.')

})()
