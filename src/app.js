const express = require('express');
const bodyParser = require('body-parser');
const { Op } = require('sequelize');
const { sequelize, Profile } = require('./model');
const { getProfile } = require('./middleware/getProfile');
const { transfer } = require('./utils');

const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

/**
 * @param {string} req.params.id - the contract's id
 * @param {string} profile_id in header
 * @returns contract by id if belongs to {profile_id}
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
  const { Contract } = req.app.get('models');
  const { id } = req.params;
  const profileId = req.get('profile_id');
  const contract = await Contract.findOne({
    where: {
      [Op.and]: [{ id }, { ContractorId: profileId }],
    },
  });
  if (!contract) return res.status(404).end();
  return res.json(contract);
});

/**
 * @param {string} profile_id in header
 * @returns a lists of non-terminated contracts where caller is either a contractor or client
 */
app.get('/contracts', getProfile, async (req, res) => {
  const { Contract } = req.app.get('models');
  const profileId = req.get('profile_id');
  const contracts = await Contract.findAll({
    where: {
      [Op.and]: [
        {
          [Op.or]: [{ ContractorId: profileId }, { ClientId: profileId }],
        },
        { status: { [Op.ne]: 'terminated' } },
      ],
    },
  });
  res.json(contracts);
});

/**
 * @param {string} profile_id in header
 * @returns a list of unpaid active jobs where caller is either a contractor or client
 */
app.get('/jobs/unpaid', getProfile, async (req, res) => {
  const { Job, Contract } = req.app.get('models');
  const profileId = req.get('profile_id');
  const jobs = await Job.findAll({
    where: {
      [Op.and]: [
        {
          [Op.or]: [
            { '$Contract.ContractorId$': profileId },
            { '$Contract.ClientId$': profileId },
          ],
        },
        { paid: null },
      ],
    },
    include: [{ model: Contract, as: Contract.name }],
  });
  res.json(jobs);
});

/**
 * if job hasnt been paid yet, and client has enough balance
 * then transfer the job's price amount from the client to contractor
 * and sets jobs as paid, and paid date
 * @param {string} job_id in url
 * @param {string} profile_id in header
 * @returns 200 status code and empty body
 */
app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
  const { Job, Contract } = req.app.get('models');
  const profileId = req.get('profile_id');
  const { job_id: jobId } = req.params;
  const job = await Job.findOne({
    where: {
      [Op.and]: [
        { id: jobId },
        {
          '$Contract.ClientId$': profileId,
        },
      ],
    },
    include: [
      {
        model: Contract,
        as: Contract.name,
        include: [
          { model: Profile, as: 'Client' },
          { model: Profile, as: 'Contractor' },
        ],
      },
    ],
  });

  const { Client: client, Contractor: contractor } = job.Contract;
  if (!job) return res.status(404).end();
  if (job.paid) return res.send(400).json({ message: 'Job already paid' });
  if (client.balance < job.value) { return res.send(400).json({ message: 'Insufficient balance' }); }

  try {
    await sequelize.transaction(async (transaction) => {
      await Promise.all([

        transfer(client.id, contractor.id, job.price, transaction),

        // sets job as paid
        Job.update(
          {
            paid: true,
            paymentDate: new Date(),
          },
          {
            where: { id: job.id },
          },
          transaction,
        ),
      ]);
    });
  } catch (error) {
    console.error({ error });
    return res.status(500).send({ message: 'Internal server error' });
  }
  return res.status(200).send();
});

/**
 * transfers req.body.amount from caller to userId
 * @param {string} userId req.params.userId - the receiver of the deposit
 * @param {string} profile_id req.profile_id - the payer
 * @param {string} req.body.amount - amount to be deposited
 * @returns 200 status code
 */
app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
  const { Job, Contract } = req.app.get('models');
  const { userId } = req.params;
  const profileId = req.get('profile_id');
  const { amount } = req.body;

  if (userId === profileId) {
    return res.status(400).send({ message: 'Cannot deposit to yourself' });
  }

  if (!amount || amount <= 0) {
    return res.status(400).send({ message: 'Invalid deposit amount' });
  }

  const totalAmountToBePaid = await Job.sum('price', {
    where: {
      [Op.and]: [
        {
          '$Contract.ClientId$': profileId,
        },
        { paid: null },
      ],
    },
    include: [{ model: Contract, as: Contract.name }],
  });
  const maxDepositValue = (25 * totalAmountToBePaid) / 100;
  if (amount > maxDepositValue) {
    return res.status(400).send({ message: 'Cannot deposit more than 25% of total of unpaid jobs' });
  }
  try {
    await transfer(profileId, userId, amount);
  } catch (error) {
    console.error({ error });
    res.status(500).send({ message: 'Internal server error' });
  }

  return res.status(200).send();
});

/**
 * @param {string} req.query.start - start date
 * @param {string} req.query.end - end date
 * @returns {Object} 200 - { profession, total }
 */
app.get('/admin/best-profession', async (req, res) => {
  const { start, end } = req.query;

  const [data] = await sequelize.query(`
  SELECT profession, max(sp) as total
    FROM (
        SELECT profession, sum(price) as sp
        FROM (
            SELECT * FROM Jobs j 
                LEFT JOIN Contracts c on c.id = j.ContractId 
                LEFT JOIN Profiles p on p.id = c.ContractorId 
                WHERE paid = TRUE
                ${start ? 'AND j.createdAt >= :startDate' : ''}
                ${end ? 'AND j.createdAt <= :endDate' : ''}
        )
        group by profession
    );`, {
    replacements: {
      // these are escaped by default, so sql injection is not a problem
      startDate: start,
      endDate: end,
    },
  });

  const result = data.pop();
  return res.status(200).send(result);
});

/**
 * @param {string} req.query.start - start date
 * @param {string} req.query.end - end date
 * @returns {Array} 200 - array of { id, fullName, paid }
 */
app.get('/admin/best-clients', async (req, res) => {
  const { start, end, limit = 2 } = req.query;
  const [result] = await sequelize.query(`
  SELECT ClientId as id, firstName || ' ' || lastName as fullName, sum(price) as paid
    FROM (
        SELECT * FROM Jobs j 
        LEFT JOIN Contracts c on j.ContractId = c.id 
        LEFT JOIN Profiles p on p.id = c.ClientId
        WHERE paid = TRUE
        ${start ? 'AND j.createdAt >= :startDate' : ''}
        ${end ? 'AND j.createdAt <= :endDate' : ''}
    )
    GROUP BY ClientId
    ORDER BY paid DESC
    LIMIT :take;
  `, {
    replacements: {
      startDate: start,
      endDate: end,
      take: limit,
    },
  });

  return res.status(200).send(result);
});

module.exports = app;
