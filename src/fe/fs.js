/**
 * @fileoverview A simple filesystem emulator.
 * Uses IndexedDB to store files across sessions, and provides
 * a front-end to manage and select the files.
 */

import {Dialog} from './dialog.js';
import {Elemental} from './elemental.js';

/** @record */
export class File {
  constructor() {
    /** @type {string} */
    this.name;
    /** @type {!ArrayBuffer} */
    this.data;
  }  
}

// Version 1 schema:
//   Files: {name: string, size: number}
//   Blobs: {name: string, data: ArrayBuffer}
//   Defaults: {pattern: string, name: string}
const VERSION = 1;
const FILES = 'Files';
const BLOBS = 'Blobs';
const DEFAULTS = 'Defaults';
const DEFAULTS_BY_NAME = 'DefaultsByName';

export class FileSystem {
  constructor() {
    this.db = new Database((db) => this.upgrade(db));
    this.elt = null;
  }

  upgrade(db) {
    db.createObjectStore(FILES, {keyPath: 'name'});
    db.createObjectStore(BLOBS, {keyPath: 'name'});
    db.createObjectStore(DEFAULTS, {keyPath: 'pattern'})
        .createIndex(DEFAULTS_BY_NAME, 'name');
  }

  manage() {
    // TODO - handle this later, for now just use the console
  }

  /**
   * @param {string=} pattern
   * @return {!Promise<!Array<string>>}
   */
  list(pattern = '*') {
    
  }

  /**
   * @param {string} intent
   * @return {!Promise<!File|undefined>}
   */
  async pick(pattern = '*',
             {ignoreDefault = false, skipDialogIfUnique = false} = {}) {
    const [allFiles, def] =
        await this.db.transaction(
            [FILES, DEFAULTS], 'readonly',
            (files, defaults) => Promise.all([
              FILES.getAll(),  
              DEFAULTS.get(pattern),
            ]));
    const files = matchGlob(allFiles, pattern);
    // Various options: 
    if (!ignoreDefault && def && files.has(def.name)) {
      return this.get(def.name);
    } else if (skipDialogIfUnique && files.size == 1) {
      return this.get(files[Symbol.iterator]().next().value);
    } else {
      // Need to open up a dialog:
      //   Pattern: [....]   [x] make default
      //     file1            45  B
      //     file2           145 kB
      //     file3           1.3 kB
      //   [cancel]
      const {element, resolve} = new Dialog();
      const topLine = element.child('div');
      const patternLabel = topLine.child('span').text('Pattern: ');
      const pattern = topLine.child('input').assign({
        type: 'text',
      }).handle('keydown', (e) => {
        if (e == 13) { // enter
          refresh();
        }
        e.stopPropagation();
        return false;
      });
// U+2610  ☐  BALLOT BOX (9744decimal · HTML &#9744;)
// U+2611  ☑  BALLOT BOX WITH CHECK (9745decimal · HTML &#9745;)
// U+2612  ☒  BALLOT BOX WITH X (9746decimal · HTML &#9746;)

      const makeDefault = topLine.child('span')
          .text('\u2610 make default')
          .handle('click', () => {
            makeDefault.element.textContent = 
              makeDefault.element.classList.toggle('checked') ?
                '\u2611 make default' : '\u2610 make default';
          });              
      const refresh = () => {
        // empty
        while (filesDiv.firstChild) {
          files.removeChild(filesDiv.firstChild);
        }
        const g = [...matchGlob(allFiles, pattern)];
        let len = 0;
        for (const [f] of g) {
          len = Math.max(f.length, len);
        }
        for (const [f, s] of matchGlob(allFiles, pattern)) {
          filesDiv.child('div')
              .text(`${f.padEnd(len)} ${human(s).padStart(8)}`)
              .data({name: f});
          // fill in stuff, use data-name to avoid new stuff
        }
      };
      const filesDiv = element.child('div').style({
        font: 'monospace',
        whiteSpace: 'pre',
      }).handle('click', (e) => {
        resolve([e.target.dataset.name,
                 makeDefault.element.classList.has('checked')]);
      });
      const upload = element.child('input')
            .assign({type: 'file'}).style({display: 'none'});
    }
  }

  /**
   * @param {string} name
   * @return {!Promise<!File|undefined>}
   */
  get(name) {
    return this.db.transaction(
        [BLOBS], 'readonly', (blobs) => request(blobs.get(name)));
  }

  /**
   * @param {string} name
   * @param {!TypedArray|!ArrayBuffer} data
   * @return {!Promise<void>}
   */
  // TODO - consider accepting strings as well, but it's tricky
  // to know whether to *return* a string or an ArrayBuffer.
  // We'd need to add a getter for the string version.
  // See MDN: TextEncoder and TextDecoder APIs.
  save(name, data, makeDefaultForPattern = null) {
    if (!(data instanceof ArrayBuffer)) {
      if (!data.buffer instanceof ArrayBuffer) {
        throw new Error(`Not an ArrayBuffer: ${data}`);
      }
      data = data.buffer;
    }
    const size = data.byteLength;
    return this.db.transaction(
        [FILES, BLOBS, DEFAULTS],
        'readwrite',
        async (files, blobs, defaults) => {
          // First look for an existing file.
          request(files.put({name, size}));
          request(blobs.put({name, data}));
          if (makeDefaultForPattern != null &&
              await request(defaults.get(makeDefaultForPattern)) == null) {
            request(defaults.put({pattern: makeDefaultForPattern, name}));
          }
    });
  }

  /**
   * @param {string} name
   */
  delete(name) {
    return this.db.transaction(
        [FILES, BLOBS], 'readwrite', (files, blobs) => {
          request(files.delete(name));
          request(blobs.delete(name));
        });
  }
}



/** Internal abstraction for the database. */
class Database {
  constructor(/** number * / version, /** function(!IDBDatabase) */ upgrade) {
    /** @const */
    this.version = version;
    /** @const */
    this.upgrade = upgrade;
    /** @type {?Promise<!IDBDatabase>} */
    this.db = null;
    this.getDb = this.getDb;
  }

  async getDb() {
    const req = window.indexedDB.open('fs', version);
    req.onupgradeneeded = (event) => this.upgrade(event.target.result);
    const db = await request(req);
    this.getDb = () => Promise.resolve(db);
    return db;
  }

  /**
   * @param {!Array<string>} stores
   * @param {string} mode
   * @param {function(!Array<!IDBObjectStore>): !Promise<T>} func
   * @return {!Promise<T>}
   * @template T
   */
  async transaction(stores, mode, func) {
    const db = await this.getDb();
    const tx = db.transaction(stores, mode);
    return new Promise((ok, fail) => {
      tx.onerror = fail;
      tx.oncomplete = () => { ok(result); };
      const result = func(stores.map(s => tx.objectStore(s)));
    });
  }
}

/**
 * @param {!IDBRequest} req
 * @return {!Promise<*>}
 */
function request(req) {
  return new Promise((ok, fail) => {
    req.onerror = fail;
    req.onsuccess = (e) => e.target.result;
  });
}

