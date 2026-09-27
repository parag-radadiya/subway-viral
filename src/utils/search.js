const MAX_SEARCH_LENGTH = 100;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Builds a case-insensitive "contains" $or clause over the given fields from
// req.query.search. Returns null when no usable search term was sent.
const buildSearchFilter = (rawSearch, fields) => {
  if (typeof rawSearch !== 'string') return null;
  const term = rawSearch.trim().slice(0, MAX_SEARCH_LENGTH);
  if (!term) return null;

  const regex = new RegExp(escapeRegex(term), 'i');
  return { $or: fields.map((field) => ({ [field]: regex })) };
};

module.exports = { buildSearchFilter, escapeRegex };
