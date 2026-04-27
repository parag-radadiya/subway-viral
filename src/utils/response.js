const sendResponse = (res, statusCode, message, data = {}) => {
  const safeData = data && typeof data === 'object' ? data : {};
  return res.status(statusCode).json({
    status: statusCode,
    message,
    data: safeData,
  });
};

const sendSuccess = (res, message, data = {}, statusCode = 200) =>
  sendResponse(res, statusCode, message, data);

module.exports = {
  sendResponse,
  sendSuccess,
};
