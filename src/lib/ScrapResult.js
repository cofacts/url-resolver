const TEXT_FIELDS = ['title', 'summary'];
const META_FIELDS = ['canonical', 'topImageUrl'];
const OVERRIDE_FIELDS = ['status'];

class ScrapResult {
  constructor(init) {
    Object.assign(this, init);
  }

  /**
   * Merge fetched fields with the following rules.
   * For text fields, choose longer fields.
   * For meta fields, only update when it does not exist.
   * For overridden fields, always use value from merged scrapResult.
   * For other fields, they are kept intact.
   *
   * @param {ScrapResult} scrapResult
   * @return {ScrapResult}
   */
  merge(scrapResult) {
    META_FIELDS.forEach(field => {
      if (typeof this[field] === 'undefined') {
        this[field] = scrapResult[field];
      }
    });

    TEXT_FIELDS.forEach(field => {
      if (
        scrapResult[field] &&
        (this[field] || '').length < scrapResult[field].length
      ) {
        this[field] = scrapResult[field];
      }
    });

    OVERRIDE_FIELDS.forEach(field => {
      this[field] = scrapResult[field];
    });
  }

  /**
   * @returns {boolean} If there are any field left not filled in
   */
  get isIncomplete() {
    return [...META_FIELDS, ...TEXT_FIELDS].some(
      field => typeof this[field] === 'undefined'
    );
  }

  /**
   * @type {string} The original URL from text
   */
  url;

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
   * Note: this field is optional.
   */
  html;

  /**
   * @type {integer} fetch status. 0 if no response.
   */
  status;
}

module.exports = ScrapResult;
