const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const USERS_FILE = path.join(__dirname, "data", "security", "users.json");

async function main() {
  const raw = fs.readFileSync(USERS_FILE, "utf8");
  const users = JSON.parse(raw);

  const updatedUsers = await Promise.all(
    users.map(async (user) => {
      const passwordHash = await bcrypt.hash("1234", 10);

      return {
        id: user.id,
        username: user.username,
        passwordHash,
        level: user.level,
        active: user.active,
      };
    })
  );

  fs.writeFileSync(USERS_FILE, JSON.stringify(updatedUsers, null, 2), "utf8");
  console.log("Users hashed successfully.");
}

main().catch(console.error);