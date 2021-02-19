const R = require("ramda");
const { VALID_RECORD_TYPES, TTL, ENV } = require("../utils/constants");
const { getDomains: gd } = require("../utils/get-domain");
const axios = require("axios");
const getRecords = R.compose(R.toPairs, R.pick(VALID_RECORD_TYPES));

const excludedHostname = ["@", "www", "aman", "is-my.page"];

const toHostList = R.chain((data) => {
  const rs = getRecords(data.record);

  return R.chain(
    ([recordType, urls]) =>
      (Array.isArray(urls) ? urls : [urls]).map((url) => ({
        hostname: data.name,
        type: recordType,
        value: (recordType === "CNAME"
          ? `${url}`.toLowerCase()
          : `${url}`
        ).replace(/\/$/g, ""),
        ttl: TTL,
      })),
    rs
  );
});

const getOldRecord = async () => {
  const oldRecords = await axios.get(
    "https://api.netlify.com/api/v1/dns_zones/60300101cb9bec00e7cb9c03/dns_records",
    {
      headers: {
        Authorization: process.env.API_TOKEN,
      },
    }
  );

  return oldRecords.data
    .map((data) => {
      return {
        ...data,
        hostname: data.hostname.split(".is-my.page")[0],
      };
    })
    .filter(
      (record) => !excludedHostname.includes(record.hostname.toLowerCase())
    );
};

const registerDomains = async ({ getDomains, log = () => {} }) => {
  const domains = await getDomains().then(toHostList);
  if (domains.length === 0)
    return Promise.reject(new Error("Nothing to register"));
  log(`${domains.length} records found`);
  const oldRecords = await getOldRecord();

  const newDomainToAdd = domains.filter((domain) => {
    const index = oldRecords.findIndex(
      (oldRecord) =>
        domain.hostname.toLowerCase() === oldRecord.hostname.toLowerCase() &&
        domain.value.toLowerCase() === oldRecord.value.toLowerCase() &&
        domain.type.toLowerCase() === oldRecord.type.toLowerCase()
    );
    if (
      index === -1 &&
      !excludedHostname.includes(domain.hostname.toLowerCase())
    ) {
      return true;
    }
    return false;
  });
  let checkOldRecordsToDelete = [];
  domains.filter((domain) => {
    const index = oldRecords.findIndex(
      (oldRecord) =>
        domain.hostname.toLowerCase() === oldRecord.hostname.toLowerCase() &&
        (domain.value.toLowerCase() !== oldRecord.value.toLowerCase() ||
          domain.type.toLowerCase() !== oldRecord.type.toLowerCase())
    );
    if (index === -1) {
      return false;
    }

    checkOldRecordsToDelete.push(oldRecords[index]);
    return true;
  });
  const oldRecordsToDelete = checkOldRecordsToDelete.filter((oldRecord) => {
    const value = domains.find(
      (domain) =>
        domain.hostname.toLowerCase() === oldRecord.hostname.toLowerCase() &&
        domain.value.toLowerCase() === oldRecord.value.toLowerCase() &&
        domain.type.toLowerCase() === oldRecord.type.toLowerCase()
    );
    if (value) return false;
    return true;
  });

  let promises = [];
  oldRecordsToDelete.map((oldRecords) => {
    const { dns_zone_id, id } = oldRecords;
    promises.push(
      axios.delete(
        `https://api.netlify.com/api/v1/dns_zones/${dns_zone_id}/dns_records/${id}`,
        {
          headers: {
            Authorization: process.env.API_TOKEN,
          },
        }
      )
    );
  });
  await Promise.all(promises);

  promises = [];
  newDomainToAdd.map((newRecords) => {
    promises.push(
      axios.post(
        "https://api.netlify.com/api/v1/dns_zones/6029004f25e9037d27fc9895/dns_records",
        newRecords,
        {
          headers: {
            Authorization: process.env.API_TOKEN,
          },
        }
      )
    );
  });
  await Promise.all(promises);
  return true;
};

const main = async () => {
  console.log(`Running in ${ENV} mode`);
  const result = await registerDomains({
    // domainService: dc,
    getDomains: gd,
    log: console.log,
  });
  console.log(result);
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  module.exports = { toHostList, registerDomains };
}
