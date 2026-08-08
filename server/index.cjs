const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const USERS_FILE = path.join(__dirname, "data", "security", "users.json");
const JWT_SECRET = "integraerp_dev_secret_change_this";

function readUsers() {
  const raw = fs.readFileSync(USERS_FILE, "utf8");
  return JSON.parse(raw);
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

function requireLevels(...allowedLevels) {
  return (req, res, next) => {
    if (!req.user || !allowedLevels.includes(req.user.level)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
}

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const users = readUsers();

    const user = users.find(
      (u) => u.username === username && u.active === true
    );

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);

    if (!validPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        level: user.level,
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        level: user.level,
        active: user.active,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/security/users", authMiddleware, requireLevels(1, 2), (req, res) => {
  try {
    const users = readUsers().map(({ passwordHash, ...rest }) => rest);
    res.json(users);
  } catch (error) {
    console.error("Get users error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/security/users", authMiddleware, requireLevels(1, 2), async (req, res) => {
  try {
    const { username, password, level, active } = req.body;
    const requesterLevel = req.user.level;

    if (requesterLevel === 2 && ![3, 4, 5].includes(Number(level))) {
      return res
        .status(403)
        .json({ message: "Level 2 can only create levels 3 to 5" });
    }

    const users = readUsers();

    const exists = users.some(
      (u) => u.username.toLowerCase() === String(username).trim().toLowerCase()
    );

    if (exists) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const passwordHash = await bcrypt.hash(String(password).trim(), 10);

    const newUser = {
      id: Date.now(),
      username: String(username).trim(),
      passwordHash,
      level: Number(level),
      active: Boolean(active),
    };

    users.push(newUser);
    writeUsers(users);

    const { passwordHash: _, ...safeUser } = newUser;
    res.status(201).json(safeUser);
  } catch (error) {
    console.error("Create user error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

app.listen(4000, () => {
  console.log("Security server running on http://localhost:4000");
});