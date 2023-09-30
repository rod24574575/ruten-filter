// ==UserScript==
// @name         Custom Filter for Ruten
// @namespace    https://github.com/rod24574575
// @description  Add additional custom front-end filters for ruten.com.tw.
// @version      0.1.0
// @license      MIT
// @author       rod24574575
// @homepage     https://github.com/rod24574575/ruten-filter
// @homepageURL  https://github.com/rod24574575/ruten-filter
// @supportURL   https://github.com/rod24574575/ruten-filter/issues
// @updateURL    https://gist.github.com/rod24574575/b237d299261a84b23bd53637c02bbdb3/raw/ruten-filter.user.js
// @downloadURL  https://gist.github.com/rod24574575/b237d299261a84b23bd53637c02bbdb3/raw/ruten-filter.user.js
// @match        *://*.ruten.com.tw/find/*
// @run-at       document-idle
// @resource     preset_figure https://gist.githubusercontent.com/rod24574575/1f2276f895205e75964338235b751f80/raw/figure.json
// @require      https://cdn.jsdelivr.net/npm/quicksettings@3.0.1/quicksettings.min.js
// @grant        GM.getResourceUrl
// @grant        GM.registerMenuCommand
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

// @ts-check

(function () {
  /**
   * @typedef {object} Settings
   * @property {Record<string,boolean>} presets
   * @property {boolean} hideAD
   * @property {boolean} hideRecommender
   * @property {Record<string,boolean>} hideProductKeywords
   * @property {Record<string,boolean>} hideSellers
   * @property {number} hideSellerCreditLessThan
   */

  /**
   * @typedef {object} ComputedSettings
   * @property {RegExp | null} hideProductKeywordMatcher
   * @property {Set<string> | null} hideSellerSet
   */

  /**
   * @typedef {Omit<Settings, 'presets'> & ComputedSettings} ParsedSettings
   */

  /**
   * @template {*} T
   * @param {Record<string,T>} dst
   * @param {Record<string,T>} src
   */
  function mergeRecords(dst, src) {
    for (const [key, value] of Object.entries(src)) {
      if (value !== undefined) {
        dst[key] = value;
      }
    }
  }

  /**
   * @param {Record<string,boolean>} enabledMap
   * @returns {string[]}
   */
  function getEnabledArray(enabledMap) {
    /** @type {string[]} */
    const results = [];
    for (const [key, value] of Object.entries(enabledMap)) {
      if (value === true) {
        results.push(key);
      }
    }
    return results;
  }

  /**
   * @returns {Promise<Settings>}
   */
  async function loadSettings() {
    /** @type {Settings} */
    const defaultSettings = {
      presets: {},
      hideAD: true,
      hideRecommender: true,
      hideProductKeywords: {},
      hideSellers: {},
      hideSellerCreditLessThan: 0,
    };

    const entries = await Promise.all(
      Object.entries(defaultSettings).map(async ([key, value]) => {
        try {
          value = await GM.getValue(key, value);
        } catch (e) {
          console.warn(e);
        }
        return /** @type {[string, any]} */ ([key, value]);
      }),
    );
    return /** @type {Settings} */ (Object.fromEntries(entries));
  }

  /**
   * @type {ParsedSettings | null}
   */
  let cachedSettings = null;

  /**
   * @param {boolean} [force]
   * @returns {Promise<ParsedSettings>}
   */
  async function ensureSettings(force = false) {
    if (!force && cachedSettings) {
      return cachedSettings;
    }

    const {
      presets,
      hideAD,
      hideRecommender,
      hideProductKeywords,
      hideSellers,
      hideSellerCreditLessThan,
    } = await loadSettings();

    const presetResults = await Promise.allSettled(
      getEnabledArray(presets).map(async (preset) => {
        const url = await GM.getResourceUrl(`preset_${preset}`);
        const resp = await fetch(url);
        return /** @type {Promise<Settings>} */ (resp.json());
      }),
    );
    for (const presetResult of presetResults) {
      if (presetResult.status === 'rejected') {
        console.warn(presetResult.reason);
        continue;
      }

      const preset = presetResult.value;
      if (preset.hideProductKeywords) {
        mergeRecords(hideProductKeywords, preset.hideProductKeywords);
      }
      if (preset.hideSellers) {
        mergeRecords(hideSellers, preset.hideSellers);
      }
    }

    /** @type {ParsedSettings['hideProductKeywordMatcher']} */
    let hideProductKeywordMatcher = null;
    const hideProductKeywordsArray = getEnabledArray(hideProductKeywords);
    if (hideProductKeywordsArray.length > 0) {
      try {
        hideProductKeywordMatcher = new RegExp(
          hideProductKeywordsArray.map(escapeRegExp).join('|'),
        );
      } catch (e) {
        console.warn(e);
      }
    }

    /** @type {ParsedSettings['hideSellerSet']} */
    let hideSellerSet = null;
    const hideSellersArray = getEnabledArray(hideSellers);
    if (hideSellersArray.length > 0) {
      hideSellerSet = hideSellersArray.reduce((set, store) => {
        set.add(store);
        return set;
      }, new Set());
    }

    return (cachedSettings = {
      hideAD,
      hideRecommender,
      hideProductKeywords,
      hideSellers,
      hideSellerCreditLessThan,
      hideProductKeywordMatcher,
      hideSellerSet,
    });
  }

  /**
   * @typedef {Element & ElementCSSInlineStyle} ElementWithStyle
   */

  /**
   * @param {string} str
   * @returns {string}
   */
  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
  }

  /**
   * @param {Element} productItem
   * @returns {any}
   */
  function getProductVueProps(productItem) {
    const product = productItem.firstElementChild;
    if (!product) {
      return undefined;
    }
    return /** @type {Element & { __vue__?: any }} */ (product).__vue__?.$props;
  }

  /**
   * @param {Element} productItem
   * @returns {boolean}
   */
  function isAd(productItem) {
    return !!productItem.querySelector('.rt-product-card-ad-tag');
  }

  /**
   * @param {Element} productItem
   * @returns {boolean}
   */
  function isRecommender(productItem) {
    return !!productItem.querySelector('.recommender-keyword');
  }

  /**
   * @param {Element} productItem
   * @param {RegExp} matcher
   * @returns {boolean}
   */
  function isProduceKeywordMatch(productItem, matcher) {
    const name = getProductVueProps(productItem)?.item?.name;
    if (!name) {
      return false;
    }
    return matcher.test(name);
  }

  /**
   * @param {Element} productItem
   * @param {Set<number|string>} storeSet
   * @returns {boolean}
   */
  function isSellers(productItem, storeSet) {
    const sellerInfo = getProductVueProps(productItem)?.item?.sellerInfo;
    if (!sellerInfo) {
      return false;
    }

    const { sellerId, sellerNick, sellerStoreName } = sellerInfo;

    /** @type {number|undefined} */
    let sellerIdNumber;
    /** @type {string|undefined} */
    let sellerIdString;
    if (typeof sellerId === 'string') {
      sellerIdNumber = parseInt(sellerId);
      sellerIdString = sellerId;
    } else if (typeof sellerId === 'number') {
      sellerIdNumber = sellerId;
      sellerIdString = String(sellerId);
    }

    return !!(
      (sellerIdNumber && storeSet.has(sellerIdNumber)) ||
      (sellerIdString && storeSet.has(sellerIdString)) ||
      (sellerNick && storeSet.has(sellerNick)) ||
      (sellerStoreName && storeSet.has(sellerStoreName))
    );
  }

  /**
   * @param {Element} productItem
   * @param {number} value
   * @returns {boolean}
   */
  function isSellerCreditLessThan(productItem, value) {
    /** @type {unknown} */
    const rawCredit = getProductVueProps(productItem)?.item?.sellerInfo?.sellerCredit;

    /** @type {number} */
    let credit;
    if (typeof rawCredit === 'number') {
      credit = rawCredit;
    } else if (typeof rawCredit === 'string') {
      credit = parseInt(rawCredit);
      if (isNaN(credit)) {
        return false;
      }
    } else {
      return false;
    }
    return credit < value;
  }

  /**
   * @param {Element} productItem
   * @param {boolean} visible
   */
  function setProductVisible(productItem, visible) {
    /** @type {ElementWithStyle} */
    (productItem).style.display = visible ? '' : 'none';
  }

  /**
   * @param {boolean} [force]
   */
  async function run(force = false) {
    const {
      hideAD,
      hideRecommender,
      hideProductKeywordMatcher,
      hideSellerSet,
      hideSellerCreditLessThan,
    } = await ensureSettings(force);

    const productItems = document.querySelectorAll('.product-item');
    if (productItems.length === 0) {
      return;
    }

    const visibles = [...productItems].map((productItem) => {
      try {
        return !(
          (hideAD && isAd(productItem)) ||
          (hideRecommender && isRecommender(productItem)) ||
          (hideProductKeywordMatcher &&
            isProduceKeywordMatch(productItem, hideProductKeywordMatcher)) ||
          (hideSellerSet && isSellers(productItem, hideSellerSet)) ||
          (hideSellerCreditLessThan > 0 &&
            isSellerCreditLessThan(productItem, hideSellerCreditLessThan))
        );
      } catch (e) {
        console.warn(e);
        return true;
      }
    });
    for (let i = productItems.length - 1; i >= 0; --i) {
      setProductVisible(productItems[i], visibles[i]);
    }
  }

  let running = false;
  const mutationObserver = new MutationObserver(async () => {
    if (running) {
      return;
    }
    running = true;
    await run();
    running = false;
  });
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
  run();

  /**
   * @typedef { typeof window & { QuickSettings?: import('quicksettings').default } } WindowWithQuickSettings
   */

  const QuickSettings = /** @type {WindowWithQuickSettings} */ (window).QuickSettings;

  /**
   * @returns {Promise<void>}
   */
  async function configure() {
    if (!QuickSettings) {
      return;
    }

    const settings = await loadSettings();

    return new Promise((resolve) => {
      /**
       * @template {keyof Settings} T
       * @param {T} key
       * @param {Settings[T]} value
       */
      function updateSettings(key, value) {
        settings[key] = value;
      }

      function destroy() {
        wrapper.remove();
        // HACK: workaround for qs js error bugs
        window.setTimeout(() => {
          panel.destroy();
        }, 0);
      }

      async function apply() {
        destroy();
        await Promise.allSettled(
          Object.entries(settings).map(async ([key, value]) => {
            return GM.setValue(key, value);
          }),
        );
        resolve();

        // Do not wait for running.
        run(true);
      }

      function cancel() {
        destroy();
        resolve();
      }

      const wrapper = document.body.appendChild(document.createElement('div'));
      Object.assign(wrapper.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '100vw',
        height: '100vh',
        'z-index': '10000',
        background: 'rgba(0,0,0,0.6)',
      });

      const panel = QuickSettings.create(0, 0, 'Configure', wrapper)
        .addBoolean('Use preset config: figure', settings.presets['figure'] ?? false, (value) => {
          updateSettings('presets', { ...settings.presets, figure: value });
        })
        .addBoolean('Hide AD', settings.hideAD, (value) => {
          updateSettings('hideAD', value);
        })
        .addBoolean('Hide recommender', settings.hideRecommender, (value) => {
          updateSettings('hideRecommender', value);
        })
        .addText(
          'Hide products that match keywords',
          getEnabledArray(settings.hideProductKeywords).join(','),
          (value) => {
            updateSettings(
              'hideProductKeywords',
              Object.fromEntries(value.split(',').map((v) => [v, true])),
            );
          },
        )
        .addText(
          'Hide sellers by name/id',
          getEnabledArray(settings.hideSellers).join(','),
          (value) => {
            updateSettings(
              'hideSellers',
              Object.fromEntries(value.split(',').map((v) => [v, true])),
            );
          },
        )
        .addNumber(
          'Hide sellers with credit less than',
          0,
          Infinity,
          settings.hideSellerCreditLessThan,
          1,
          (value) => {
            updateSettings('hideSellerCreditLessThan', value);
          },
        )
        .addButton('Apply', apply)
        .addButton('Cancel', cancel);

      Object.assign(/** @type {*} */ (panel)._panel.style, {
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
      });
    });
  }

  if (QuickSettings) {
    let configuring = false;
    GM.registerMenuCommand('Configure', async () => {
      if (configuring) {
        return;
      }
      configuring = true;
      await configure();
      configuring = false;
    });
  }
})();
