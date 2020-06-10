// When one of these fields is undefined, the scrap result is considered incomplete.
const REQUIRED_FIELDS = ['canonical', 'topImageUrl', 'title', 'summary'];

// Merge strategy: use longer when merge()
const USE_LONGER_FIELDS = ['title', 'summary', 'html'];

// Merge strategy: only update when current field is undefined
const PREFER_CURRENT_FIELDS = ['canonical', 'topImageUrl'];

// Merge strategy: always use new field
const PREFER_NEW_FIELDS = ['status'];

class ScrapResult {
  constructor(init) {
    Object.assign(this, init);
  }

  /**
   * Merge each field using the strategy defined above.
   * For other fields, they are kept intact.
   *
   * @param {ScrapResult} scrapResult
   * @return {ScrapResult}
   */
  merge(scrapResult) {
    PREFER_CURRENT_FIELDS.forEach(field => {
      if (typeof this[field] === 'undefined') {
        this[field] = scrapResult[field];
      }
    });

    USE_LONGER_FIELDS.forEach(field => {
      if (
        typeof scrapResult[field] === 'string' &&
        (this[field] || '').length < scrapResult[field].length
      ) {
        this[field] = scrapResult[field];
      }
    });

    PREFER_NEW_FIELDS.forEach(field => {
      this[field] = scrapResult[field];
    });
  }

  /**
   * @returns {boolean} If there are any required field left not filled in
   */
  get isIncomplete() {
    return REQUIRED_FIELDS.some(field => typeof this[field] === 'undefined');
  }

  /**
   * @type {string} Canonical URL
   */
  canonical;

  /**
   * @type {string}
   */
  title;

  /**
   * @type {string}
   */
  summary;

  /**
   * @type {string}
   */
  topImageUrl;

  /**
   * @type {string}
   *
   * Note: this field is not required.
   */
  html;

  /**
   * @type {integer} fetch status. 0 if no response.
   */
  status;
}

module.exports = ScrapResult;
