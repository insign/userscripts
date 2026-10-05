// ==UserScript==
// @name         [WORKING] Unlock any Medium Article
// @namespace    https://github.com/insign/userscripts
// @version      2026.10.05.1218
// @description  Unlock paywalled articles via Freedium: Medium (including custom domains), NYT, Washington Post, Bloomberg, Economist, Reuters and FT
// @author       Hélio <open@helio.me>
// @match        *://*/*
// @grant        none
// @license      WTFPL
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict'

  // Paywalled-outlet matchers adapted from the Freedium redirect script
  // by Mathix420 / ZhymabekRoman.
  const FREEDIUM_URL = 'https://freedium-mirror.cfd/'
  const FREEDIUM_HOSTS = ['freedium-mirror.cfd']
  const BYPASS_HASH = '#bypass'
  const OBSERVER_TIMEOUT_MS = 10000

  const matchesDomain = (hostname, domain) =>
    hostname === domain || hostname.endsWith(`.${domain}`)

  const isOnFreedium = hostname => {
    try {
      return FREEDIUM_HOSTS.some(domain => matchesDomain(hostname, domain))
    } catch (e) {
      console.log('Unlock article: failed to check hostname', e)
      return false
    }
  }

  const cameFromFreedium = () => {
    const { referrer } = document
    if (!referrer) return false
    try {
      return isOnFreedium(new URL(referrer).hostname)
    } catch (e) {
      console.log('Unlock article: failed to parse referrer', e)
      return false
    }
  }

  const redirectToFreedium = () => {
    try {
      if (window.location.hash === BYPASS_HASH) return
      if (isOnFreedium(window.location.hostname)) return
      if (cameFromFreedium()) return
      window.location.replace(FREEDIUM_URL + window.location.href)
    } catch (e) {
      console.log('Unlock article: redirect failed', e)
    }
  }

  // --- Medium detection (any domain, including custom domains) ---
  const isMediumArticle = () => {
    try {
      if (document.querySelector('meta[data-rh="true"][property="al:ios:app_name"][content="Medium"]')) {
        return true
      }
      const androidUrl = document.head?.querySelector('meta[property="al:android:url"]')?.content
      return Boolean(androidUrl?.includes('medium://p/'))
    } catch (e) {
      console.log('Unlock article: Medium detection failed', e)
      return false
    }
  }

  const checkMediumAndRedirect = () => {
    try {
      if (window.location.href.includes('/edit?source=')) return false
      if (!isMediumArticle()) return false
      redirectToFreedium()
      return true
    } catch (e) {
      console.log('Unlock article: Medium check failed', e)
      return false
    }
  }

  // --- Other supported paywalled outlets (path-based) ---
  const isSupportedOutletArticle = () => {
    const { hostname, pathname: path } = window.location

    if (matchesDomain(hostname, 'nytimes.com')) {
      return /^\/\d{4}\/\d{2}\/\d{2}\/.+\.html\/?$/.test(path) ||
        /^\/athletic\/\d+\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/.test(path)
    }
    if (matchesDomain(hostname, 'washingtonpost.com')) {
      return /^\/(?:[^/]+\/)*\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/.test(path)
    }
    if (matchesDomain(hostname, 'bloomberg.com')) {
      return /^\/news\/articles\/\d{4}-\d{2}-\d{2}\/[^/]+\/?$/.test(path)
    }
    if (matchesDomain(hostname, 'economist.com')) {
      return /^\/[^/]+\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/.test(path)
    }
    if (matchesDomain(hostname, 'reuters.com')) {
      return /^\/.+-\d{4}-\d{2}-\d{2}\/?$/.test(path)
    }
    if (matchesDomain(hostname, 'ft.com')) {
      return /^\/content\/[0-9a-f-]+\/?$/i.test(path)
    }
    return false
  }

  // Watch briefly for late (client-side rendered) Medium metadata,
  // common on custom domains.
  const watchForMediumArticle = () => {
    try {
      if (!document.documentElement) return
      const observer = new MutationObserver(() => {
        if (checkMediumAndRedirect()) observer.disconnect()
      })
      observer.observe(document.documentElement, { subtree: true, childList: true })
      setTimeout(() => observer.disconnect(), OBSERVER_TIMEOUT_MS)
    } catch (e) {
      console.log('Unlock article: observer failed', e)
    }
  }

  // --- Main ---
  const main = () => {
    try {
      if (window.location.hash === BYPASS_HASH) return
      if (isOnFreedium(window.location.hostname)) return
      if (isSupportedOutletArticle()) {
        redirectToFreedium()
        return
      }
      if (checkMediumAndRedirect()) return
      if (document.documentElement) {
        watchForMediumArticle()
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          if (!checkMediumAndRedirect()) watchForMediumArticle()
        }, { once: true })
      }
    } catch (e) {
      console.log('Unlock article: main failed', e)
    }
  }

  main()
})()
