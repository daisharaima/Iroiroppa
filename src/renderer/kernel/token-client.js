'use strict';

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
