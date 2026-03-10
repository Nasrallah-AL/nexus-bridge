const express = require('express');
const request = require('supertest');
const createHealthRoute = require('../../src/routes/health');

describe('Health Route', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.get('/health', createHealthRoute());
  });

  test('should return 200 OK', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
  });

  test('should return status: ok', async () => {
    const response = await request(app).get('/health');
    expect(response.body).toHaveProperty('status', 'ok');
  });

  test('should return timestamp', async () => {
    const response = await request(app).get('/health');
    expect(response.body).toHaveProperty('timestamp');
    expect(typeof response.body.timestamp).toBe('string');

    // Verify timestamp is valid ISO string
    expect(() => new Date(response.body.timestamp)).not.toThrow();
  });

  test('should return uptime', async () => {
    const response = await request(app).get('/health');
    expect(response.body).toHaveProperty('uptime');
    expect(typeof response.body.uptime).toBe('number');
    expect(response.body.uptime).toBeGreaterThan(0);
  });

  test('should return Content-Type: application/json', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });
});
