const request = require('supertest');
const app = require('../src/app');
const { Job } = require('../src/model');

describe('app e2e tests', () => {
  describe('/contracts/:id', () => {
    test('it should return the contract data', (done) => {
      request(app)
        .get('/contracts/1')
        .set('profile_id', 5)
        .then((response) => {
          expect(response.statusCode).toBe(200);
          expect(response.body.id).toBe(1);
          done();
        });
    });

    test('it should return 404', (done) => {
      request(app)
        .get('/contracts/1')
        .set('profile_id', 1)
        .then((response) => {
          expect(response.statusCode).toBe(404);
          done();
        });
    });
  });

  describe('/contracts', () => {
    test('it should return an array of contracts', (done) => {
      request(app)
        .get('/contracts')
        .set('profile_id', 1)
        .then((response) => {
          expect(response.statusCode).toBe(200);
          expect(Array.isArray(response.body)).toBe(true);
          expect(response.body[0].id).toBe(2);
          done();
        });
    });
  });

  describe('/jobs/unpaid', () => {
    test('it should return an array of unpaid jobs', (done) => {
      request(app)
        .get('/jobs/unpaid')
        .set('profile_id', 6)
        .then((response) => {
          expect(response.statusCode).toBe(200);
          expect(Array.isArray(response.body)).toBe(true);

          response.body.forEach((job) => expect(job.paid).toBe(null));
          done();
        });
    });
  });

  describe('/jobs/:job_id/pay', () => {
    test('it should transfer the amount correctly and set job as paid', (done) => {
      const jobId = 2;
      request(app)
        .post(`/jobs/${jobId}/pay`)
        .set('profile_id', 1)
        .then(async (response) => {
          expect(response.statusCode).toBe(200);
          const job = await Job.findOne({ where: { id: jobId } });
          expect(job.paid).toBe(true);
          done();
        });
    });
  });

  describe('/balances/deposit/:userId', () => {
    test('it should transfer value correctly', (done) => {
      request(app)
        .post('/balances/deposit/2')
        .set('profile_id', 1)
        .set('Content-Type', 'application/json')
        .send({ amount: 50 })
        .then((response) => {
          expect(response.statusCode).toBe(200);
          done();
        });
    });

    describe('when amount is invalid', () => {
      test('it should return 400 with error message', (done) => {
        request(app)
          .post('/balances/deposit/2')
          .set('profile_id', 1)
          .set('Content-Type', 'application/json')
          .send({ amount: 99999999 })
          .then((response) => {
            expect(response.statusCode).toBe(400);
            done();
          });
      });
    });
  });

  describe('/admin/best-profession', () => {
    test('it should return the profession and total amount received', (done) => {
      request(app)
        .get('/admin/best-profession')
        .then((response) => {
          expect(response.statusCode).toBe(200);
          expect(response.body).toEqual({
            profession: 'Programmer',
            total: 2884,
          });
          done();
        });
    });
  });

  describe('/admin/best-clients', () => {
    test('it should return an array of clients', (done) => {
      request(app)
        .get('/admin/best-clients')
        .then((response) => {
          expect(response.statusCode).toBe(200);
          expect(response.body.length).toBe(2);
          expect(response.body[0].fullName).toBe('Ash Kethcum');
          done();
        });
    });
  });
});
