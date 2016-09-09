import { QueryError } from './errors';
import { nested } from './utils';
import sift from 'sift';
import assign from 'lodash/assign';
import isArray from 'lodash/isArray';
import isNumber from 'lodash/isNumber';
import isString from 'lodash/isString';
import isObject from 'lodash/isObject';
import isRegExp from 'lodash/isRegExp';
import isEmpty from 'lodash/isEmpty';
import forEach from 'lodash/forEach';
import findKey from 'lodash/findKey';
const unsupportedFilters = ['$nearSphere'];

/**
 * The Query class is used to query for a subset of
 * entities using the Kinvey API.
 *
 * @example
 * var query = new Kinvey.Query();
 * query.equalTo('name', 'Kinvey');
 */
export class Query {
  /**
   * Create an instance of the Query class.
   *
   * @param {Object} options Options
   * @param {string[]} [options.fields=[]] Fields to select.
   * @param {Object} [options.filter={}] MongoDB query.
   * @param {Object} [options.sort={}] The sorting order.
   * @param {?number} [options.limit=null] Number of entities to select.
   * @param {number} [options.skip=0] Number of entities to skip from the start.
   * @return {Query} The query.
   */
  constructor(options) {
    options = assign({
      fields: [],
      filter: {},
      sort: {},
      limit: null,
      skip: 0
    }, options);

    /**
     * Fields to select.
     *
     * @type {string[]}
     */
    this.fields = options.fields;

    /**
     * The MongoDB query.
     *
     * @type {Object}
     */
    this.filter = options.filter;

    /**
     * The sorting order.
     *
     * @type {Object}
     */
    this.sort = options.sort;

    /**
     * Number of entities to select.
     *
     * @type {?number}
     */
    this.limit = options.limit;

    /**
     * Number of entities to skip from the start.
     *
     * @type {number}
     */
    this.skip = options.skip;

    /**
     * Maintain reference to the parent query in case the query is part of a
     * join.
     *
     * @type {?Query}
     */
    this._parent = null;
  }

  /**
   * @type {string[]}
   */
  get fields() {
    return this._fields;
  }

  /**
   * @type {string[]}
   */
  set fields(fields) {
    fields = fields || [];

    if (!isArray(fields)) {
      throw new QueryError('fields must be an Array');
    }

    if (this._parent) {
      this._parent.fields = fields;
    } else {
      this._fields = fields;
    }
  }

  /**
   * @type {Object}
   */
  get filter() {
    return this._filter;
  }

  /**
   * @type {Object}
   */
  set filter(filter) {
    this._filter = filter;
  }

  /**
   * @type {Object}
   */
  get sort() {
    return this._sort;
  }

  /**
   * @type {Object}
   */
  set sort(sort) {
    if (sort && !isObject(sort)) {
      throw new QueryError('sort must an Object');
    }

    if (this._parent) {
      this._parent.sort(sort);
    } else {
      this._sort = sort || {};
    }
  }

  /**
   * @type {?number}
   */
  get limit() {
    return this._limit;
  }

  /**
   * @type {?number}
   */
  set limit(limit) {
    if (isString(limit)) {
      limit = parseFloat(limit);
    }

    if (limit && !isNumber(limit)) {
      throw new QueryError('limit must be a number');
    }

    if (this._parent) {
      this._parent.limit = limit;
    } else {
      this._limit = limit;
    }
  }

  /**
   * @type {number}
   */
  get skip() {
    return this._skip;
  }

  /**
   * @type {number}
   */
  set skip(skip = 0) {
    if (isString(skip)) {
      skip = parseFloat(skip);
    }

    if (!isNumber(skip)) {
      throw new QueryError('skip must be a number');
    }

    if (this._parent) {
      this._parent.skip(skip);
    } else {
      this._skip = skip;
    }
  }

  /**
   * Checks if the query is able to be run offline on the local cache.
   * @return {Boolean} True if it is able to be run offline otherwise false.
   */
  isSupportedOffline() {
    let supported = true;

    forEach(unsupportedFilters, filter => {
      supported = !findKey(this.filter, filter);
      return supported;
    });

    return supported;
  }

  /**
   * Adds an equal to filter to the query. Requires `field` to equal `value`.
   * Any existing filters on `field` will be discarded.
   * @see https://docs.mongodb.com/manual/reference/operator/query/#comparison
   *
   * @param {string} field Field
   * @param {*} value Value
   * @returns {Query} The query.
   */
  equalTo(field, value) {
    return this.addFilter(field, '$eq', value);
  }

  /**
   * Adds a contains filter to the query. Requires `field` to contain at least
   * one of the members of `list`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/in
   *
   * @param {string} field Field
   * @param {array} values List of values.
   * @throws {QueryError} `values` must be of type `Array`.
   * @returns {Query} The query.
   */
  contains(field, values) {
    if (!isArray(values)) {
      values = [values];
    }

    return this.addFilter(field, '$in', values);
  }

  /**
   * Adds a contains all filter to the query. Requires `field` to contain all
   * members of `list`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/all
   *
   * @param {string} field Field
   * @param {Array} values List of values.
   * @throws {QueryError} `values` must be of type `Array`.
   * @returns {Query} The query.
   */
  containsAll(field, values) {
    if (!isArray(values)) {
      values = [values];
    }

    return this.addFilter(field, '$all', values);
  }

  /**
   * Adds a greater than filter to the query. Requires `field` to be greater
   * than `value`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/gt
   *
   * @param {string} field Field
   * @param {number|string} value Value
   * @throws {QueryError} `value` must be of type `number` or `string`.
   * @returns {Query} The query.
   */
  greaterThan(field, value) {
    if (!isNumber(value) && !isString(value)) {
      throw new QueryError('You must supply a number or string.');
    }

    return this.addFilter(field, '$gt', value);
  }

  /**
   * Adds a greater than or equal to filter to the query. Requires `field` to
   * be greater than or equal to `value`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/gte
   *
   * @param {string} field Field.
   * @param {number|string} value Value.
   * @throws {QueryError} `value` must be of type `number` or `string`.
   * @returns {Query} The query.
   */
  greaterThanOrEqualTo(field, value) {
    if (!isNumber(value) && !isString(value)) {
      throw new QueryError('You must supply a number or string.');
    }

    return this.addFilter(field, '$gte', value);
  }

  /**
   * Adds a less than filter to the query. Requires `field` to be less than
   * `value`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/lt
   *
   * @param {string} field Field
   * @param {number|string} value Value
   * @throws {QueryError} `value` must be of type `number` or `string`.
   * @returns {Query} The query.
   */
  lessThan(field, value) {
    if (!isNumber(value) && !isString(value)) {
      throw new QueryError('You must supply a number or string.');
    }

    return this.addFilter(field, '$lt', value);
  }

  /**
   * Adds a less than or equal to filter to the query. Requires `field` to be
   * less than or equal to `value`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/lte
   *
   * @param {string} field Field
   * @param {number|string} value Value
   * @throws {QueryError} `value` must be of type `number` or `string`.
   * @returns {Query} The query.
   */
  lessThanOrEqualTo(field, value) {
    if (!isNumber(value) && !isString(value)) {
      throw new QueryError('You must supply a number or string.');
    }

    return this.addFilter(field, '$lte', value);
  }

  /**
   * Adds a not equal to filter to the query. Requires `field` not to equal
   * `value`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/ne
   *
   * @param {string} field Field
   * @param {*} value Value
   * @returns {Query} The query.
   */
  notEqualTo(field, value) {
    return this.addFilter(field, '$ne', value);
  }

  /**
   * Adds a not contained in filter to the query. Requires `field` not to
   * contain any of the members of `list`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/nin
   *
   * @param {string} field Field
   * @param {Array} values List of values.
   * @throws {QueryError} `values` must be of type `Array`.
   * @returns {Query} The query.
   */
  notContainedIn(field, values) {
    if (!isArray(values)) {
      values = [values];
    }

    return this.addFilter(field, '$nin', values);
  }

  /**
   * Performs a logical AND operation on the query and the provided queries.
   * @see https://docs.mongodb.com/manual/reference/operator/query/and
   *
   * @param {...Query|...Object} args Queries
   * @throws {QueryError} `query` must be of type `Array<Query>` or `Array<Object>`.
   * @returns {Query} The query.
   */
  and(...args) {
    // AND has highest precedence. Therefore, even if this query is part of a
    // JOIN already, apply it on this query.
    return this.join('$and', args);
  }

  /**
   * Performs a logical NOR operation on the query and the provided queries.
   * @see https://docs.mongodb.com/manual/reference/operator/query/nor
   *
   * @param {...Query|...Object} args Queries
   * @throws {QueryError} `query` must be of type `Array<Query>` or `Array<Object>`.
   * @returns {Query} The query.
   */
  nor(...args) {
    // NOR is preceded by AND. Therefore, if this query is part of an AND-join,
    // apply the NOR onto the parent to make sure AND indeed precedes NOR.
    if (this._parent && this._parent.filter.$and) {
      return this._parent.nor.apply(this._parent, args);
    }

    return this.join('$nor', args);
  }

  /**
   * Performs a logical OR operation on the query and the provided queries.
   * @see https://docs.mongodb.com/manual/reference/operator/query/or
   *
   * @param {...Query|...Object} args Queries.
   * @throws {QueryError} `query` must be of type `Array<Query>` or `Array<Object>`.
   * @returns {Query} The query.
   */
  or(...args) {
    // OR has lowest precedence. Therefore, if this query is part of any join,
    // apply the OR onto the parent to make sure OR has indeed the lowest
    // precedence.
    if (this._parent) {
      return this._parent.or.apply(this._parent, args);
    }

    return this.join('$or', args);
  }

  /**
   * Adds an exists filter to the query. Requires `field` to exist if `flag` is
   * `true`, or not to exist if `flag` is `false`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/exists
   *
   * @param {string} field Field
   * @param {boolean} [flag=true] The exists flag.
   * @returns {Query} The query.
   */
  exists(field, flag) {
    flag = typeof flag === 'undefined' ? true : flag || false;
    return this.addFilter(field, '$exists', flag);
  }

  /**
   * Adds a modulus filter to the query. Requires `field` modulo `divisor` to
   * have remainder `remainder`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/mod
   *
   * @param {string} field Field
   * @param {number} divisor Divisor
   * @param {number} [remainder=0] Remainder
   * @throws {QueryError} `divisor` must be of type: `number`.
   * @throws {QueryError} `remainder` must be of type: `number`.
   * @returns {Query} The query.
   */
  mod(field, divisor, remainder = 0) {
    if (isString(divisor)) {
      divisor = parseFloat(divisor);
    }

    if (isString(remainder)) {
      remainder = parseFloat(remainder);
    }

    if (!isNumber(divisor)) {
      throw new QueryError('divisor must be a number');
    }

    if (!isNumber(remainder)) {
      throw new QueryError('remainder must be a number');
    }

    return this.addFilter(field, '$mod', [divisor, remainder]);
  }

  /**
   * Adds a match filter to the query. Requires `field` to match `regExp`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/regex
   *
   * @param {string} field Field
   * @param {RegExp|string} regExp Regular expression.
   * @param {Object} [options] Options
   * @param {boolean} [options.ignoreCase=inherit] Toggles case-insensitivity.
   * @param {boolean} [options.multiline=inherit] Toggles multiline matching.
   * @param {boolean} [options.extended=false] Toggles extended capability.
   * @param {boolean} [options.dotMatchesAll=false] Toggles dot matches all.
   * @returns {Query} The query.
   */
  matches(field, regExp, options = {}) {
    if (!isRegExp(regExp)) {
      regExp = new RegExp(regExp);
    }

    if ((regExp.ignoreCase || options.ignoreCase) && options.ignoreCase !== false) {
      throw new QueryError('ignoreCase glag is not supported.');
    }

    if (regExp.source.indexOf('^') !== 0) {
      throw new QueryError('regExp must have `^` at the beginning of the expression ' +
        'to make it an anchored expression.');
    }

    const flags = [];

    if ((regExp.multiline || options.multiline) && options.multiline !== false) {
      flags.push('m');
    }

    if (options.extended) {
      flags.push('x');
    }

    if (options.dotMatchesAll) {
      flags.push('s');
    }

    const result = this.addFilter(field, '$regex', regExp.source);

    if (flags.length) {
      this.addFilter(field, '$options', flags.join(''));
    }

    return result;
  }

  /**
   * Adds a near filter to the query. Requires `field` to be a coordinate
   * within `maxDistance` of `coord`. Sorts documents from nearest to farthest.
   * @see https://docs.mongodb.com/manual/reference/operator/query/near
   *
   * @param {string} field The field.
   * @param {Array<number, number>} coord The coordinate (longitude, latitude).
   * @param {number} [maxDistance] The maximum distance (miles).
   * @throws {QueryError} `coord` must be of type `Array<number, number>`.
   * @returns {Query} The query.
   */
  near(field, coord, maxDistance) {
    if (!isArray(coord) || !isNumber(coord[0]) || !isNumber(coord[1])) {
      throw new QueryError('coord must be a [number, number]');
    }

    const result = this.addFilter(field, '$nearSphere', [coord[0], coord[1]]);

    if (maxDistance) {
      this.addFilter(field, '$maxDistance', maxDistance);
    }

    return result;
  }

  /**
   * Adds a within box filter to the query. Requires `field` to be a coordinate
   * within the bounds of the rectangle defined by `bottomLeftCoord`,
   * `bottomRightCoord`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/box
   *
   * @param {string} field The field.
   * @param {Array<number, number>} bottomLeftCoord The bottom left coordinate (longitude, latitude).
   * @param {Array<number, number>} upperRightCoord The bottom right coordinate (longitude, latitude).
   * @throws {QueryError} `bottomLeftCoord` must be of type `Array<number, number>`.
   * @throws {QueryError} `bottomRightCoord` must be of type `Array<number, number>`.
   * @returns {Query} The query.
   */
  withinBox(field, bottomLeftCoord, upperRightCoord) {
    if (!isArray(bottomLeftCoord) || !bottomLeftCoord[0] || !bottomLeftCoord[1]) {
      throw new QueryError('bottomLeftCoord must be a [number, number]');
    }

    if (!isArray(upperRightCoord) || !upperRightCoord[0] || !upperRightCoord[1]) {
      throw new QueryError('upperRightCoord must be a [number, number]');
    }

    bottomLeftCoord[0] = parseFloat(bottomLeftCoord[0]);
    bottomLeftCoord[1] = parseFloat(bottomLeftCoord[1]);
    upperRightCoord[0] = parseFloat(upperRightCoord[0]);
    upperRightCoord[1] = parseFloat(upperRightCoord[1]);

    const coords = [
      [bottomLeftCoord[0], bottomLeftCoord[1]],
      [upperRightCoord[0], upperRightCoord[1]]
    ];
    return this.addFilter(field, '$within', { $box: coords });
  }

  /**
   * Adds a within polygon filter to the query. Requires `field` to be a
   * coordinate within the bounds of the polygon defined by `coords`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/polygon
   *
   * @param {string} field The field.
   * @param {Array<Array<number, number>>} coords List of coordinates.
   * @throws {QueryError} `coords` must be of type `Array<Array<number, number>>`.
   * @returns {Query} The query.
   */
  withinPolygon(field, coords) {
    if (!isArray(coords) || coords.length > 3) {
      throw new QueryError('coords must be [[number, number]]');
    }

    coords = coords.map(coord => {
      if (!coord[0] || !coord[1]) {
        throw new QueryError('coords argument must be [number, number]');
      }

      return [parseFloat(coord[0]), parseFloat(coord[1])];
    });

    return this.addFilter(field, '$within', { $polygon: coords });
  }

  /**
   * Adds a size filter to the query. Requires `field` to be an `Array` with
   * exactly `size` members.
   * @see https://docs.mongodb.com/manual/reference/operator/query/size
   *
   * @param {string} field Field
   * @param {number} size Size
   * @throws {QueryError} `size` must be of type: `number`.
   * @returns {Query} The query.
   */
  size(field, size) {
    if (isString(size)) {
      size = parseFloat(size);
    }

    if (!isNumber(size)) {
      throw new QueryError('size must be a number');
    }

    return this.addFilter(field, '$size', size);
  }

  /**
   * Adds an ascending sort modifier to the query. Sorts by `field`, ascending.
   *
   * @param {string} field Field
   * @returns {Query} The query.
   */
  ascending(field) {
    if (this._parent) {
      this._parent.ascending(field);
    } else {
      this.sort[field] = 1;
    }

    return this;
  }

  /**
   * Adds an descending sort modifier to the query. Sorts by `field`,
   * descending.
   *
   * @param {string} field Field
   * @returns {Query} The query.
   */
  descending(field) {
    if (this._parent) {
      this._parent.descending(field);
    } else {
      this.sort[field] = -1;
    }

    return this;
  }

  /**
   * Adds a filter to the query.
   *
   * @param {string} field Field
   * @param {string} condition Condition
   * @param {*} values Values
   * @returns {Query} The query.
   */
  addFilter(field, condition, values) {
    if (!isObject(this.filter[field])) {
      this.filter[field] = {};
    }

    this.filter[field][condition] = values;
    return this;
  }

  /**
   * @private
   * Joins the current query with another query using an operator.
   *
   * @param {string} operator Operator
   * @param {Query[]|Object[]} queries Queries
   * @throws {QueryError} `query` must be of type `Query[]` or `Object[]`.
   * @returns {Query} The query.
   */
  join(operator, queries) {
    let that = this;
    const currentQuery = {};

    // Cast, validate, and parse arguments. If `queries` are supplied, obtain
    // the `filter` for joining. The eventual return function will be the
    // current query.
    queries = queries.map(query => {
      if (!(query instanceof Query)) {
        if (isObject(query)) {
          query = new Query(query);
        } else {
          throw new QueryError('query argument must be of type: Kinvey.Query[] or Object[].');
        }
      }

      return query.toJSON().filter;
    });

    // If there are no `queries` supplied, create a new (empty) `Query`.
    // This query is the right-hand side of the join expression, and will be
    // returned to allow for a fluent interface.
    if (queries.length === 0) {
      that = new Query();
      queries = [that.toJSON().filter];
      that.parent = this; // Required for operator precedence and `toJSON`.
    }

    // Join operators operate on the top-level of `filter`. Since the `toJSON`
    // magic requires `filter` to be passed by reference, we cannot simply re-
    // assign `filter`. Instead, empty it without losing the reference.
    const members = Object.keys(this.filter);
    forEach(members, member => {
      currentQuery[member] = this.filter[member];
      delete this.filter[member];
    });

    // `currentQuery` is the left-hand side query. Join with `queries`.
    this.filter[operator] = [currentQuery].concat(queries);

    // Return the current query if there are `queries`, and the new (empty)
    // `PrivateQuery` otherwise.
    return that;
  }

  /**
   * @private
   * Processes the data by applying fields, sort, limit, and skip.
   *
   * @param {Array} data The raw data.
   * @throws {QueryError} `data` must be of type `Array`.
   * @returns {Array} The processed data.
   */
  process(data) {
    if (this.isSupportedOffline() === false) {
      let message = 'This query is not able to run locally. The following filters are not supported'
        + ' locally:';

      forEach(unsupportedFilters, filter => {
        message = `${message} ${filter}`;
      });

      throw new QueryError(message);
    }

    if (data) {
      // Validate arguments.
      if (!isArray(data)) {
        throw new QueryError('data argument must be of type: Array.');
      }

      // Apply the query
      const json = this.toJSON();
      data = sift(json.filter, data);

      // Remove fields
      if (json.fields && json.fields.length > 0) {
        data = data.map((item) => {
          const keys = Object.keys(item);
          forEach(keys, key => {
            if (json.fields.indexOf(key) === -1) {
              delete item[key];
            }
          });

          return item;
        });
      }

      // Sorting.
      data = data.sort((a, b) => {
        const fields = Object.keys(json.sort);
        forEach(fields, field => {
          // Find field in objects.
          const aField = nested(a, field);
          const bField = nested(b, field);

          // Elements which do not contain the field should always be sorted
          // lower.
          if (aField && !bField) {
            return -1;
          }

          if (bField && !aField) {
            return 1;
          }

          // Sort on the current field. The modifier adjusts the sorting order
          // (ascending (-1), or descending(1)). If the fields are equal,
          // continue sorting based on the next field (if any).
          if (aField !== bField) {
            const modifier = json.sort[field]; // 1 or -1.
            return (aField < bField ? -1 : 1) * modifier;
          }

          return 0;
        });

        return 0;
      });

      // Limit and skip.
      if (json.limit) {
        return data.slice(json.skip, json.skip + json.limit);
      }

      return data.slice(json.skip);
    }

    return data;
  }

  /**
   * Returns Object representation of the query.
   *
   * @returns {Object} Object
   */
  toPlainObject() {
    if (this._parent) {
      return this._parent.toPlainObject();
    }

    // Return set of parameters.
    const json = {
      fields: this.fields,
      filter: this.filter,
      sort: this.sort,
      skip: this.skip,
      limit: this.limit
    };

    return json;
  }

  /**
   * Returns Object representation of the query.
   *
   * @returns {Object} Object
   * @deprecated Use toPlainObject() instead.
   */
  toJSON() {
    return this.toPlainObject();
  }

  /**
   * Returns query string representation of the query.
   *
   * @returns {Object} Query string object.
   */
  toQueryString() {
    const queryString = {};

    if (!isEmpty(this.filter)) {
      queryString.query = this.filter;
    }

    if (!isEmpty(this.fields)) {
      queryString.fields = this.fields.join(',');
    }

    if (this.limit) {
      queryString.limit = this.limit;
    }

    if (this.skip > 0) {
      queryString.skip = this.skip;
    }

    if (!isEmpty(this.sort)) {
      queryString.sort = this.sort;
    }

    const keys = Object.keys(queryString);
    forEach(keys, key => {
      queryString[key] = isString(queryString[key]) ? queryString[key] : JSON.stringify(queryString[key]);
    });

    return queryString;
  }

  /**
   * Returns query string representation of the query.
   *
   * @return {string} Query string string.
   */
  toString() {
    return JSON.stringify(this.toQueryString());
  }
}
