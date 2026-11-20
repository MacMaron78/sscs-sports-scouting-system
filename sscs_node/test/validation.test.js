import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAthleteUpdate, normalizeRegistration, normalizeSearch } from "../src/validation.js";

test("normalizes a valid athlete registration and accepts sport-specific statistics", () => {
    const registration = normalizeRegistration({
        username: "athlete.one",
        email: "ATHLETE@example.com",
        password: "example-strong-pass",
        role: "athlete",
        firstName: "Avery",
        lastName: "Player",
        sport: "Track and Field",
        position: "100m",
        age: "21",
        location: "Kampala, Uganda",
        competitionLevel: "National",
        careerHistory: [{ team: "Kampala Athletics", period: "2023–2025" }],
        performanceStats: { "100m best": "10.8 seconds" },
    });

    assert.equal(registration.email, "athlete@example.com");
    assert.equal(registration.profile.age, 21);
    assert.equal(registration.profile.competitionLevel, "National");
    assert.equal(registration.profile.careerHistory[0].team, "Kampala Athletics");
    assert.equal(registration.profile.performanceStats["100m best"], "10.8 seconds");
});

test("rejects privileged role selection during public registration", () => {
    assert.throws(
        () => normalizeRegistration({
            username: "administrator",
            email: "admin@example.com",
            password: "example-strong-pass",
            role: "admin",
        }),
        /Choose Athlete or Scout\/Agency/,
    );
});

test("rejects invalid URLs and malformed age filters", () => {
    assert.throws(
        () => normalizeAthleteUpdate({ videoLink: "javascript:alert(1)" }),
        /http or https/,
    );
    assert.throws(() => normalizeSearch({ age: "twenty" }), /whole number/);
});
