import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import bcrypt from "bcryptjs";
import { initializeDatabase, pool } from "./db.js";

function readHidden(prompt) {
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
        throw new Error("Run npm run create-admin from an interactive terminal.");
    }
    return new Promise((resolve, reject) => {
        stdout.write(prompt);
        stdin.setRawMode(true);
        stdin.resume();
        let value = "";
        const onData = (buffer) => {
            for (const char of buffer.toString("utf8")) {
                if (char === "\u0003") {
                    stdin.setRawMode(false);
                    stdin.pause();
                    stdin.off("data", onData);
                    reject(new Error("Admin setup cancelled."));
                    return;
                }
                if (char === "\r" || char === "\n") {
                    stdin.setRawMode(false);
                    stdin.pause();
                    stdin.off("data", onData);
                    stdout.write("\n");
                    resolve(value);
                    return;
                }
                if (char === "\u007f" || char === "\b") {
                    value = value.slice(0, -1);
                } else if (char >= " ") {
                    value += char;
                }
            }
        };
        stdin.on("data", onData);
    });
}

let input;
try {
    await initializeDatabase(pool);
    input = readline.createInterface({ input: stdin, output: stdout });
    const username = (await input.question("Admin username: ")).trim();
    const email = (await input.question("Admin email: ")).trim().toLowerCase();
    input.close();
    const password = await readHidden("Admin password (hidden): ");
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
        throw new Error("Username must be 3–30 characters using letters, numbers, dots, underscores, or hyphens.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    if (password.length < 10 || password.length > 128) throw new Error("Password must be 10–128 characters.");
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
        `INSERT INTO "${process.env.PGSCHEMA || "sscs_api"}".users
            (username, email, password_hash, role)
         VALUES ($1, $2, $3, 'admin')`,
        [username, email, passwordHash],
    );
    console.log("SSCS API admin account created.");
} catch (error) {
    if (error.code === "23505") {
        console.error("That username or email is already registered.");
        process.exitCode = 1;
    } else {
        console.error(error.message);
        process.exitCode = 1;
    }
} finally {
    input?.close();
    await pool.end();
}
