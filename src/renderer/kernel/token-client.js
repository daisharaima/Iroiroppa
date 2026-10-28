'use strict';

// The token consumer toolkit for the renderer (docs/STATE.md, §12.6).
//
// Re-exports the shared token model and consumer helpers so a module consumes the
// canonical model the way a the token layer target does — flatten, filter by type,
// extract colours — without reaching for the raw shared globals.

(function () {
  const Model = window.IroTokenModel;
  const Schema = window.IroTokenSchema;

  window.Iro = window.Iro || {};
  window.Iro.tokens = {
    model: Model,
    schema: Schema,
    resolve: Model.resolveToken,
    collection: Model.createCollection,
    multiMode: Model.createMultiModeCollection,
    payload: Model.createPayload,
    flatten: Schema.flattenPayload,
    filterByType: Schema.filterPayloadByType,
    colors: Schema.extractColorTokens,
    parse: Schema.parseSyncMessage,
  };
})();
