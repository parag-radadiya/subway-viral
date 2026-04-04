function parsePagination(query = {}, options = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const defaultLimit = options.defaultLimit || 20;
  const maxLimit = options.maxLimit || 100;
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));

  const rawSortOrder = String(query.sort_order || options.defaultSortOrder || 'desc').toLowerCase();
  const sortOrder = rawSortOrder === 'asc' ? 1 : -1;

  const allowedSortBy = options.allowedSortBy || [];
  const defaultSortBy = options.defaultSortBy || 'createdAt';
  const sortBy = allowedSortBy.includes(query.sort_by) ? query.sort_by : defaultSortBy;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    sort: { [sortBy]: sortOrder },
  };
}

function toPageMeta(total, page, limit, count) {
  return {
    total,
    page,
    limit,
    total_pages: total ? Math.ceil(total / limit) : 0,
    count,
  };
}

module.exports = {
  parsePagination,
  toPageMeta,
};
