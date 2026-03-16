const expectEnvelope = (response, expectedStatus) => {
  expect(response.statusCode).toBe(expectedStatus);
  expect(response.body).toEqual(
    expect.objectContaining({
      status: expectedStatus,
      message: expect.any(String),
      data: expect.any(Object),
    })
  );
};

module.exports = { expectEnvelope };

