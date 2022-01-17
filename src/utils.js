const { sequelize, Profile } = require('./model');

/**
 * @param {string} from -- profile id who is paying
 * @param {string} to -- profile id who is receving
 * @param {number} amount to be transfered
 * @param {Sequelize.transaction} transaction
 * @returns {Sequelize.transaction}
 */
async function transfer(from, to, amount, transaction) {
  const t = transaction || await sequelize.transaction();
  await Promise.all([
    Profile.update(
      {
        balance: sequelize.literal(`balance - ${amount}`),
      },
      {
        where: { id: from },
      },
      t,
    ),

    Profile.update(
      {
        balance: sequelize.literal(`balance + ${amount}`),
      },
      {
        where: { id: to },
      },
      t,
    ),
  ]);

  return t;
}

module.exports = { transfer };
