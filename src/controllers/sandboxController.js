const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const { cloneProductionToSandbox } = require('../services/dbCloneService');

/**
 * @desc    Clone the production database into the sandbox database.
 *          Overwrites the sandbox with an exact snapshot of production.
 * @route   POST /api/sandbox/clone
 * @access  Root only
 */
const cloneToSandbox = asyncHandler(async (req, res) => {
  // Explicit confirmation guard — this overwrites the entire sandbox database.
  if (req.body?.confirm !== true) {
    throw new AppError(
      'Confirmation required: send { "confirm": true } to overwrite the sandbox database with production data.',
      400
    );
  }

  const batchSize = Number(req.body?.batch_size);
  const summary = await cloneProductionToSandbox(
    Number.isFinite(batchSize) && batchSize > 0 ? { batchSize } : {}
  );

  return sendSuccess(res, 'Production database cloned into sandbox', summary);
});

module.exports = { cloneToSandbox };
