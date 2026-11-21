import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import bcrypt from "bcryptjs";
import { SetupError } from "./database-target.js";

function readHidden(prompt) {
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
        throw new SetupError("Run the administrator setup command from an interactive terminal.");
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
                    reject(new SetupError("Admin setup cancelled."));
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

export async function createAdmin(databasePool, schema, production = false) {
    const input = readline.createInterface({ input: stdin, output: stdout });
    try {
        if (production) {
            const confirmation = await input.question(
                "Verified Neon neondb/sscs_api. Type CREATE ADMIN to create the first production administrator: ",
            );
            if (confirmation !== "CREATE ADMIN") {
                throw new SetupError("Confirmation did not match. No account was created.");
            }
        }

        const username = (await input.question("Admin username: ")).trim();
        const email = (await input.question("Admin email: ")).trim().toLowerCase();
        input.close();
        const password = await readHidden("Admin password (hidden): ");
        const passwordConfirmation = await readHidden("Confirm admin password (hidden): ");
        if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
            throw new SetupError("Username must be 3–30 characters using letters, numbers, dots, underscores, or hyphens.");
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
            throw new SetupError("Enter a valid email address.");
        }
        if (password.length < 10 || password.length > 128) {
            throw new SetupError("Password must be 10–128 characters.");
        }
        if (password !== passwordConfirmation) throw new SetupError("Passwords do not match.");
        const passwordHash = await bcrypt.hash(password, 12);
        await databasePool.query(
            `INSERT INTO "${schema}".users
                (username, email, password_hash, role, verification_status)
             VALUES ($1, $2, $3, 'admin', 'verified')`,
            [username, email, passwordHash],
        );
        console.log(production
            ? "Production administrator account created."
            : "Local administrator account created.");
    } finally {
        input.close();
    }
}
