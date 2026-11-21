import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, formatDate } from "./api";
import { useAuth } from "./auth";
import { AthleteCard, AuthProgressBar, EmptyState, ErrorNotice, Loading, PageIntro, PhotoAvatar, SuccessNotice, VerificationBadge, VerifiedAccountTick } from "./components";
import { AdminSupportInbox } from "./support";

function PageLoading() {
    return <Loading label="Loading SSCS data…" />;
}

function careerText(entries = []) {
    return entries.map((entry) => [
        entry.team,
        entry.period || "",
        entry.competition || "",
        entry.notes || "",
    ].join(" | ")).join("\n");
}

function parseCareerText(text) {
    return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
        const [team = "", period = "", competition = "", notes = ""] = line.split("|").map((part) => part.trim());
        return { team, period, competition, notes };
    });
}

function statsText(stats = {}) {
    return JSON.stringify(stats, null, 2);
}

function profileFormValues(profileType, profile) {
    if (profileType === "athlete") return {
        firstName: profile.first_name ?? "",
        lastName: profile.last_name ?? "",
        sport: profile.sport ?? "",
        position: profile.position ?? "",
        age: profile.age ?? "",
        location: profile.location ?? "",
        competitionLevel: profile.competition_level ?? "",
        bio: profile.bio ?? "",
        videoLink: profile.video_link ?? "",
        careerHistoryText: careerText(profile.career_history),
        performanceStatsText: statsText(profile.performance_stats),
    };
    return {
        agencyName: profile.agency_name ?? "",
        country: profile.country ?? "",
        contactPhone: profile.contact_phone ?? "",
        contactDetails: profile.contact_details ?? "",
    };
}

function profileFormValuesEqual(left, right) {
    if (!left || !right) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
        && keys.every((key) => String(left[key] ?? "") === String(right[key] ?? ""));
}

function Field({ label, name, value, onChange, type = "text", required = false, ...props }) {
    return <label className="form-field">
        <span>{label}{required && <span className="required-mark"> *</span>}</span>
        <input name={name} type={type} value={value} onChange={onChange} required={required} {...props} />
    </label>;
}

function TextArea({ label, name, value, onChange, rows = 4, required = false, ...props }) {
    return <label className="form-field">
        <span>{label}{required && <span className="required-mark"> *</span>}</span>
        <textarea name={name} rows={rows} value={value} onChange={onChange} required={required} {...props} />
    </label>;
}

function PerformanceStatsField({ name, value, onChange, id }) {
    function readRows(statsText) {
        const stats = JSON.parse(statsText || "{}");
        if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
            throw new Error("Performance data must be an object of statistic names and values.");
        }
        return Object.entries(stats).map(([label, statValue]) => ({
            label,
            value: statValue && typeof statValue === "object" ? JSON.stringify(statValue) : String(statValue ?? ""),
        }));
    }

    const [rows, setRows] = useState(() => readRows(value));
    const [duplicateLabel, setDuplicateLabel] = useState(false);

    useEffect(() => {
        setRows(readRows(value));
    }, [value]);

    function commitRows(nextRows) {
        setRows(nextRows);
        const stats = Object.fromEntries(nextRows
            .filter((row) => row.label.trim())
            .map((row) => [row.label.trim(), row.value.trim()]));
        onChange({ target: { name, value: JSON.stringify(stats, null, 2) } });
    }

    function updateRow(index, key, nextValue) {
        if (key === "label" && nextValue.trim() && rows.some((row, rowIndex) => rowIndex !== index && row.label.trim().toLocaleLowerCase() === nextValue.trim().toLocaleLowerCase())) {
            setDuplicateLabel(true);
            return;
        }
        if (key === "label") setDuplicateLabel(false);
        commitRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: nextValue } : row));
    }

    return <fieldset className="performance-stats-editor" aria-describedby={`${id}-help`}>
        <legend className="sr-only">Sport-specific performance data (optional)</legend>
        <p className="performance-stats-guidance" id={`${id}-help`}>
            Add measurable results that help scouts understand your sporting background (for example, sprint times, goals, assists, personal bests, or competition results). Include units where useful. SSCS displays what you enter; it does not calculate or independently verify performance claims.
        </p>
        {rows.length > 0 && <div className="performance-stat-rows">
            {rows.map((row, index) => <div className="performance-stat-row" key={`${index}-${row.label}`}>
                <label className="form-field">
                    <span>Statistic or record</span>
                    <input
                        type="text"
                        value={row.label}
                        onChange={(event) => updateRow(index, "label", event.target.value)}
                        maxLength={100}
                        placeholder="e.g. 100m best"
                        aria-label={`Statistic or record ${index + 1}`}
                    />
                </label>
                <label className="form-field">
                    <span>Result (include units)</span>
                    <input
                        type="text"
                        value={row.value}
                        onChange={(event) => updateRow(index, "value", event.target.value)}
                        maxLength={255}
                        placeholder="e.g. 10.8 seconds"
                        aria-label={`Result for statistic ${index + 1}`}
                    />
                </label>
                <button className="performance-stat-remove" type="button" onClick={() => commitRows(rows.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Remove statistic ${row.label || index + 1}`}>Remove</button>
            </div>)}
        </div>}
        {duplicateLabel && <p className="performance-stats-error" role="status">Each statistic needs a unique name. Use a different label for this record.</p>}
        {rows.length === 0 && <p className="performance-stats-empty">No performance records added yet. This section is optional.</p>}
        <button className="performance-stat-add" type="button" onClick={() => setRows((current) => [...current, { label: "", value: "" }])}>
            <span aria-hidden="true">+</span> Add a statistic
        </button>
    </fieldset>;
}

const commonSports = [
    "Football", "Basketball", "Rugby", "Swimming", "Track and Field", "Volleyball",
    "Cricket", "Tennis", "Badminton", "Table Tennis", "Netball", "Field Hockey",
    "Ice Hockey", "Baseball", "Softball", "Handball", "American Football",
    "Boxing", "Wrestling", "Judo", "Taekwondo", "Karate", "Mixed Martial Arts",
    "Cycling", "Gymnastics", "Rowing", "Canoeing", "Kayaking", "Sailing",
    "Triathlon", "Weightlifting", "Powerlifting", "Golf", "Squash", "Fencing",
    "Archery", "Shooting", "Equestrian", "Surfing", "Skateboarding",
    "Rock Climbing", "Diving", "Water Polo", "Modern Pentathlon", "Motorsport",
    "Athletics", "Cross Country", "Marathon", "Beach Volleyball", "Lacrosse",
    "Rugby Sevens", "BMX", "Mountain Biking", "Figure Skating", "Speed Skating",
    "Kickboxing", "Muay Thai", "DanceSport", "Cheerleading", "Bowling",
];

const positionsBySport = {
    Football: ["Goalkeeper", "Centre-back", "Left-back", "Right-back", "Wing-back", "Defensive midfielder", "Central midfielder", "Attacking midfielder", "Left winger", "Right winger", "Striker", "Centre-forward"],
    Basketball: ["Point guard", "Shooting guard", "Small forward", "Power forward", "Center"],
    Rugby: ["Loosehead prop", "Hooker", "Tighthead prop", "Lock", "Blindside flanker", "Openside flanker", "Number 8", "Scrum-half", "Fly-half", "Left wing", "Outside centre", "Inside centre", "Right wing", "Fullback"],
    Swimming: ["Freestyle", "Backstroke", "Breaststroke", "Butterfly", "Individual medley", "Freestyle relay", "Medley relay", "Open water"],
    "Track and Field": ["100m", "200m", "400m", "800m", "1500m", "5000m", "10,000m", "Hurdles", "Steeplechase", "Relay", "Long jump", "Triple jump", "High jump", "Pole vault", "Shot put", "Discus", "Javelin", "Hammer throw", "Decathlon", "Heptathlon"],
    Volleyball: ["Setter", "Outside hitter", "Opposite hitter", "Middle blocker", "Libero", "Defensive specialist"],
    Cricket: ["Opening batter", "Top-order batter", "Middle-order batter", "Wicketkeeper", "Fast bowler", "Spin bowler", "All-rounder"],
    Tennis: ["Singles", "Doubles", "Mixed doubles"],
    Badminton: ["Singles", "Doubles", "Mixed doubles"],
    "Table Tennis": ["Singles", "Doubles", "Mixed doubles"],
    Netball: ["Goal shooter", "Goal attack", "Wing attack", "Centre", "Wing defence", "Goal defence", "Goal keeper"],
    "Field Hockey": ["Goalkeeper", "Defender", "Midfielder", "Forward"],
    "Ice Hockey": ["Goalkeeper", "Left defence", "Right defence", "Left wing", "Centre", "Right wing"],
    Baseball: ["Pitcher", "Catcher", "First baseman", "Second baseman", "Third baseman", "Shortstop", "Left fielder", "Center fielder", "Right fielder"],
    Softball: ["Pitcher", "Catcher", "First baseman", "Second baseman", "Third baseman", "Shortstop", "Left fielder", "Center fielder", "Right fielder"],
    Handball: ["Goalkeeper", "Left wing", "Left back", "Center back", "Right back", "Right wing", "Pivot"],
    "American Football": ["Quarterback", "Running back", "Wide receiver", "Tight end", "Offensive line", "Defensive line", "Linebacker", "Cornerback", "Safety", "Kicker", "Punter"],
    Boxing: ["Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight", "Middleweight", "Light heavyweight", "Heavyweight"],
    Wrestling: ["Freestyle", "Greco-Roman", "Women's wrestling"],
    Judo: ["Lightweight", "Middleweight", "Heavyweight", "Open category"],
    Taekwondo: ["Kyorugi", "Poomsae"],
    Karate: ["Kata", "Kumite"],
    "Mixed Martial Arts": ["Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight", "Middleweight", "Light heavyweight", "Heavyweight"],
    Cycling: ["Road racing", "Time trial", "Track sprint", "Track endurance", "BMX racing", "Mountain bike cross-country", "Mountain bike downhill"],
    Gymnastics: ["Floor", "Vault", "Uneven bars", "Balance beam", "Pommel horse", "Still rings", "Parallel bars", "Horizontal bar", "All-around", "Rhythmic"],
    Rowing: ["Single sculls", "Double sculls", "Quadruple sculls", "Coxless pair", "Coxless four", "Eight", "Coxswain"],
    Canoeing: ["Canoe sprint", "Canoe slalom", "C1", "C2"],
    Kayaking: ["Kayak sprint", "Kayak slalom", "K1", "K2", "K4"],
    Sailing: ["Helm", "Crew", "Skipper", "Dinghy", "Keelboat", "Windsurfing"],
    Triathlon: ["Sprint distance", "Olympic distance", "Middle distance", "Long distance", "Aquathlon", "Duathlon"],
    Weightlifting: ["Snatch", "Clean and jerk", "Total"],
    Powerlifting: ["Squat", "Bench press", "Deadlift", "Powerlifting total"],
    Golf: ["Individual", "Team"],
    Squash: ["Singles", "Doubles"],
    Fencing: ["Foil", "Épée", "Sabre"],
    Archery: ["Recurve", "Compound", "Barebow"],
    Shooting: ["Rifle", "Pistol", "Shotgun"],
    Equestrian: ["Dressage", "Show jumping", "Eventing", "Endurance"],
    Surfing: ["Shortboard", "Longboard", "Bodyboard"],
    Skateboarding: ["Street", "Park", "Vert"],
    "Rock Climbing": ["Lead", "Bouldering", "Speed"],
    Diving: ["Springboard", "Platform", "Synchronized diving"],
    "Water Polo": ["Goalkeeper", "Center forward", "Center back", "Driver", "Wing"],
    "Modern Pentathlon": ["Fencing", "Obstacle", "Swimming", "Laser run"],
    Motorsport: ["Driver", "Rider", "Rally", "Circuit racing", "Karting"],
    Athletics: ["100m", "200m", "400m", "800m", "1500m", "5000m", "10,000m", "Hurdles", "Steeplechase", "Relay", "Long jump", "Triple jump", "High jump", "Pole vault", "Shot put", "Discus", "Javelin", "Hammer throw", "Decathlon", "Heptathlon"],
    "Cross Country": ["Short distance", "Long distance", "Relay"],
    Marathon: ["Marathon", "Half marathon", "Road running"],
    "Beach Volleyball": ["Defender", "Blocker"],
    Lacrosse: ["Attack", "Midfield", "Defense", "Goalkeeper", "Faceoff specialist"],
    "Rugby Sevens": ["Prop", "Hooker", "Scrum-half", "Fly-half", "Center", "Wing", "Fullback"],
    BMX: ["Racing", "Freestyle park", "Freestyle flatland", "Freestyle street"],
    "Mountain Biking": ["Cross-country", "Downhill", "Enduro", "Marathon", "Freeride"],
    "Figure Skating": ["Singles", "Pairs", "Ice dance", "Synchronized skating"],
    "Speed Skating": ["Short track", "Long track", "Mass start", "Team pursuit"],
    Kickboxing: ["Light contact", "Full contact", "K-1", "Point fighting"],
    "Muay Thai": ["Amateur", "Professional", "Wai kru"],
    DanceSport: ["Standard", "Latin", "Ten dance", "Solo"],
    Cheerleading: ["Flyer", "Base", "Back spot", "Tumbling", "All-star"],
    Bowling: ["Ten-pin", "Nine-pin", "Five-pin", "Duckpin"],
};

function SportField({ name = "sport", value = "", onChange, required = false }) {
    const [customSport, setCustomSport] = useState(() => Boolean(value) && !commonSports.includes(value));

    function selectSport(event) {
        if (event.target.value === "other") {
            if (!customSport) {
                onChange({ target: { name, value: "" } });
                onChange({ target: { name: "position", value: "" } });
            }
            setCustomSport(true);
            return;
        }
        setCustomSport(false);
        onChange({ target: { name, value: event.target.value } });
        onChange({ target: { name: "position", value: "" } });
    }

    return <label className="form-field sport-picker">
        <span>Sport / discipline{required && <span className="required-mark"> *</span>}</span>
        <select value={customSport ? "other" : commonSports.includes(value) ? value : ""} onChange={selectSport} required>
            <option value="" disabled>Choose a sport</option>
            {commonSports.map((sport) => <option value={sport} key={sport}>{sport}</option>)}
            <option value="other">Other (enter your sport)</option>
        </select>
        {customSport && <input
            name={name}
            value={value}
            onChange={onChange}
            placeholder="Type any sport or discipline"
            maxLength={100}
            required
            aria-label="Enter your sport or discipline"
        />}
        <small>Choose a common sport or select Other to enter any sport or discipline.</small>
    </label>;
}

function PositionField({ name = "position", sport = "", value = "", onChange, required = false }) {
    const options = positionsBySport[sport] || [];
    const [customPosition, setCustomPosition] = useState(() => Boolean(value) && (!options.length || !options.includes(value)));
    const previousSport = useRef(sport);

    useEffect(() => {
        if (previousSport.current !== sport) {
            previousSport.current = sport;
            setCustomPosition(false);
        }
    }, [sport]);

    function selectPosition(event) {
        if (event.target.value === "other") {
            setCustomPosition(true);
            onChange({ target: { name, value: "" } });
            return;
        }
        setCustomPosition(false);
        onChange({ target: { name, value: event.target.value } });
    }

    return <label className="form-field position-picker">
        <span>Position / event{required && <span className="required-mark"> *</span>}</span>
        {options.length > 0 ? <>
            <select
                value={customPosition ? "other" : options.includes(value) ? value : ""}
                onChange={selectPosition}
                required={required && !customPosition}
            >
                <option value="" disabled>{sport ? "Choose a position or event" : "Choose a sport first"}</option>
                {options.map((position) => <option value={position} key={position}>{position}</option>)}
                <option value="other">Other (add my position / event)</option>
            </select>
            {customPosition && <input
                name={name}
                value={value}
                onChange={onChange}
                maxLength={100}
                placeholder={`Enter your ${sport} position or event`}
                required={required}
                aria-label={`Enter your ${sport} position or event`}
            />}
            <small>Select a listed option or add your own if it is not shown.</small>
        </> : <>
            <input
                name={name}
                value={value}
                onChange={onChange}
                maxLength={100}
                placeholder={sport ? `Enter your ${sport} position or event` : "Choose a sport first"}
                required={required}
                disabled={!sport}
            />
            <small>{sport ? "Add the position or event used in your sport." : "Choose a sport to see suggested positions or events."}</small>
        </>}
    </label>;
}

export function HomePage() {
    const { user } = useAuth();
    const [summary, setSummary] = useState(null);
    const [error, setError] = useState("");

    useEffect(() => {
        api("/public/summary").then(setSummary).catch((requestError) => setError(requestError.message));
    }, []);

    const action = user?.role === "scout"
        ? <Link className="button" to="/athletes">Explore athletes <span>→</span></Link>
        : user?.role === "athlete"
            ? <Link className="button" to="/profile">Manage your profile <span>→</span></Link>
            : user?.role === "admin"
                ? <Link className="button" to="/admin">Open admin dashboard <span>→</span></Link>
                : <Link className="button" to="/register">Create your account <span>→</span></Link>;

    return <div className="home-page">
        <section className="hero-panel editorial-hero">
            <div className="stadium-backdrop" aria-hidden="true">
                <div className="stadium-pitch" />
            </div>
            <div className="hero-copy">
                <p className="eyebrow eyebrow-light">SPORTS SCOUTING &amp; COORDINATION SYSTEM</p>
                <h1>Get seen.<br />Get scouted.<br /><span>Go further.</span></h1>
                <p className="hero-description">A platform for athletes to tell their story, and for scouts to find the people who can change the game.</p>
                <div className="hero-actions">{action}{!user && <Link className="button button-glass" to="/login">I already have an account</Link>}</div>
                <div className="sport-chips"><span>Football</span><span>Basketball</span><span>Rugby</span><span>Swimming</span><span>Track &amp; field</span><span>Every sport</span></div>
            </div>
            <div className="hero-art editorial-art" aria-hidden="true">
                <div className="orbit orbit-one"></div><div className="orbit orbit-two"></div>
                <div className="hero-ball">S</div>
                <div className="editorial-art-label editorial-art-label-top"><span className="live-dot"></span> THE TALENT NETWORK</div>
                <div className="editorial-art-label editorial-art-label-bottom">DISCOVER <span>·</span> CONNECT <span>·</span> GROW</div>
                <div className="editorial-art-stamp">SSCS<br /><span>SCOUTING<br />THE FUTURE</span></div>
                <div className="hero-network-card hero-network-card-athlete">
                    <span className="hero-network-card-mark">01</span>
                    <span><strong>ATHLETE PROFILE</strong><small>Career · results · highlights</small></span>
                    <i aria-hidden="true">↗</i>
                </div>
                <div className="hero-network-card hero-network-card-scout">
                    <span className="hero-network-card-mark">02</span>
                    <span><strong>SCOUTING NETWORK</strong><small>Search · shortlist · connect</small></span>
                    <i aria-hidden="true">↗</i>
                </div>
            </div>
        </section>

        <ErrorNotice error={error} />
        <section className="metric-row editorial-metrics" aria-label="Platform overview">
            <div className="metric"><span className="metric-icon">01</span><div><strong>{summary?.athlete_count ?? "—"}</strong><span>Athletes in the network</span></div></div>
            <div className="metric"><span className="metric-icon">02</span><div><strong>{summary?.agency_count ?? "—"}</strong><span>Agencies discovering talent</span></div></div>
            <div className="metric metric-description"><span className="metric-icon">03</span><div><strong>One network</strong><span>Built to move opportunity forward</span></div></div>
        </section>

        <section className="steps-section editorial-steps">
            <div className="section-title"><p className="eyebrow">MORE THAN A PROFILE</p><h2>Make your next move count.</h2><p>Every great sporting journey deserves to be seen, understood, and connected to opportunity.</p></div>
            <div className="step-grid editorial-step-grid">
                <article className="step-card"><span className="step-number">01</span><div className="step-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0M16 5h5m-2.5-2.5v5M17 14h4m-4 4h4" /></svg></div><h3>Build a sporting profile</h3><p>Bring your sport, career history, performance information, and highlights together in one profile.</p></article>
                <article className="step-card"><span className="step-number">02</span><div className="step-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M8 10.5h5m-2.5-2.5v5" /></svg></div><h3>Discover talent</h3><p>Search across sports and explore athletes using the details that matter to your recruitment.</p></article>
                <article className="step-card"><span className="step-number">03</span><div className="step-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 12h8m-3-3 3 3-3 3" /><circle cx="12" cy="12" r="9" /></svg></div><h3>Connect directly</h3><p>Save promising prospects and start a conversation through the platform.</p></article>
            </div>
        </section>
        <section className="home-pathways">
            <div className="pathway-heading">
                <p className="eyebrow">ONE COMMUNITY. TWO SIDES OF THE GAME.</p>
                <h2>Wherever you play a part,<br /><span>there’s a place for you.</span></h2>
            </div>
            <div className="pathway-grid">
                <article className="pathway-card pathway-athlete">
                    <span className="pathway-index">01 / ATHLETES</span>
                    <span className="pathway-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg></span>
                    <h3>Your journey.<br />Your moment.</h3>
                    <p>Build a profile that brings your career, performance, and potential into focus.</p>
                    <Link to={user?.role === "athlete" ? "/profile" : "/register"} className="pathway-link">{user?.role === "athlete" ? "Manage your athlete profile" : "Create an athlete profile"} <span>↗</span></Link>
                </article>
                <article className="pathway-card pathway-scout">
                    <span className="pathway-index">02 / SCOUTS &amp; AGENCIES</span>
                    <span className="pathway-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg></span>
                    <h3>Find the talent<br />that moves you.</h3>
                    <p>Search across sports, discover new prospects, and start a direct conversation.</p>
                    <Link to={user?.role === "scout" ? "/athletes" : "/register?role=scout"} className="pathway-link">{user?.role === "scout" ? "Explore athlete directory" : "Join as a scout"} <span>↗</span></Link>
                </article>
            </div>
        </section>
        {!user && <section className="bottom-cta"><div><p className="eyebrow eyebrow-light">YOUR NEXT STEP</p><h2>Bring your talent into view.</h2><p>Join the SSCS network as an athlete or as a scout/agency.</p></div><Link className="button button-white" to="/register">Get started <span>→</span></Link></section>}
    </div>;
}

export function AuthPage({ mode }) {
    const isRegister = mode === "register";
    const { login, register } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [role, setRole] = useState(() => isRegister && searchParams.get("role") === "scout" ? "scout" : "athlete");
    const [values, setValues] = useState({ username: "", email: "", password: "", firstName: "", lastName: "", sport: "", position: "", age: "", location: "", competitionLevel: "", bio: "", videoLink: "", careerHistoryText: "", performanceStatsText: "{}", agencyName: "", country: "Uganda", contactPhone: "", contactDetails: "" });
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    function update(event) {
        setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
    }

    async function submit(event) {
        event.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            if (isRegister) {
                let performanceStats;
                try {
                    performanceStats = JSON.parse(values.performanceStatsText || "{}");
                } catch {
                    throw new Error("Performance information must be valid JSON, for example {\"100m best\":\"10.8 seconds\"}.");
                }
                const profileValues = role === "athlete"
                    ? {
                        firstName: values.firstName,
                        lastName: values.lastName,
                        sport: values.sport,
                        position: values.position,
                        age: values.age || null,
                        location: values.location,
                        competitionLevel: values.competitionLevel,
                        bio: values.bio,
                        videoLink: values.videoLink,
                        careerHistory: parseCareerText(values.careerHistoryText),
                        performanceStats,
                    }
                    : {
                        agencyName: values.agencyName,
                        country: values.country,
                        contactPhone: values.contactPhone,
                        contactDetails: values.contactDetails,
                    };
                await register({
                    username: values.username,
                    email: values.email,
                    password: values.password,
                    role,
                    ...profileValues,
                });
                navigate(role === "athlete" ? "/athlete-dashboard" : "/scout-dashboard");
            } else {
                await login(values.email, values.password);
                navigate("/");
            }
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSubmitting(false);
        }
    }

    return <section className="auth-layout">
        <div className="auth-aside">
            <p className="eyebrow eyebrow-light">SSCS COMMUNITY</p>
            <h1>{isRegister ? "Your next chapter starts here." : "Welcome back to your network."}</h1>
            <p>{isRegister ? "Create a profile and open a new path between sporting talent and opportunity." : "Sign in to continue building connections and discovering talent."}</p>
            <div className="auth-aside-list"><span>✓ Athlete-first profiles</span><span>✓ Multi-sport discovery</span><span>✓ Direct communication</span></div>
        </div>
        <div className="auth-card">
            <p className="eyebrow">{isRegister ? "JOIN THE NETWORK" : "YOUR SSCS ACCOUNT"}</p>
            <h2>{isRegister ? "Create your account" : "Log in"}</h2>
            <p className="form-intro">{isRegister ? "Choose your account type and add your details." : "Enter your account details to continue."}</p>
            <ErrorNotice error={error} />
            <form onSubmit={submit}>
                {isRegister && <div className="role-picker">
                    <label className={role === "athlete" ? "role-option selected" : "role-option"}>
                        <input type="radio" name="role" value="athlete" checked={role === "athlete"} onChange={() => setRole("athlete")} />
                        <span className="role-symbol">♙</span><span><strong>Athlete</strong><small>Showcase your journey</small></span>
                    </label>
                    <label className={role === "scout" ? "role-option selected" : "role-option"}>
                        <input type="radio" name="role" value="scout" checked={role === "scout"} onChange={() => setRole("scout")} />
                        <span className="role-symbol">⌕</span><span><strong>Scout / Agency</strong><small>Discover sporting talent</small></span>
                    </label>
                </div>}
                <div className="form-grid">
                    {isRegister && <Field label="Username" name="username" value={values.username} onChange={update} required autoComplete="username" minLength={3} maxLength={30} />}
                    <Field label="Email address" name="email" type="email" value={values.email} onChange={update} required autoComplete="email" />
                    {isRegister && <Field label="Password" name="password" type="password" value={values.password} onChange={update} required autoComplete="new-password" minLength={10} />}
                    {!isRegister && <Field label="Password" name="password" type="password" value={values.password} onChange={update} required autoComplete="current-password" />}
                </div>
                {isRegister && role === "athlete" && <div className="role-fields">
                    <h3>Athlete profile</h3>
                    <div className="form-grid two-col">
                        <Field label="First name" name="firstName" value={values.firstName} onChange={update} required />
                        <Field label="Last name" name="lastName" value={values.lastName} onChange={update} required />
                        <SportField name="sport" value={values.sport} onChange={update} required />
                        <PositionField name="position" sport={values.sport} value={values.position} onChange={update} required />
                        <Field label="Age" name="age" type="number" value={values.age} onChange={update} min={0} max={125} />
                        <Field label="Geographical location" name="location" value={values.location} onChange={update} required placeholder="City, district, country" />
                        <label className="form-field">
                            <span>Highest competition level</span>
                            <select name="competitionLevel" value={values.competitionLevel} onChange={update}>
                                <option value="">Select level</option>
                                <option value="Club">Club</option>
                                <option value="Regional">Regional</option>
                                <option value="National">National</option>
                                <option value="International">International</option>
                            </select>
                        </label>
                    </div>
                    <TextArea label="Athlete bio" name="bio" value={values.bio} onChange={update} rows={3} />
                    <Field label="External video link (optional)" name="videoLink" type="url" value={values.videoLink} onChange={update} placeholder="https://…" />
                    <TextArea label="Career history (one entry per line: club | years | competition | notes)" name="careerHistoryText" value={values.careerHistoryText} onChange={update} rows={3} placeholder={"Kampala Athletics | 2023–2025 | National League | Team captain"} />
                    <PerformanceStatsField id="registration-performance-stats" name="performanceStatsText" value={values.performanceStatsText} onChange={update} />
                </div>}
                {isRegister && role === "scout" && <div className="role-fields">
                    <h3>Agency profile</h3>
                    <div className="form-grid two-col">
                        <Field label="Agency name" name="agencyName" value={values.agencyName} onChange={update} required />
                        <Field label="Country" name="country" value={values.country} onChange={update} required />
                        <Field label="Contact phone" name="contactPhone" type="tel" value={values.contactPhone} onChange={update} />
                    </div>
                    <TextArea label="Agency contact details" name="contactDetails" value={values.contactDetails} onChange={update} rows={3} placeholder="Public contact email, address, or other details" />
                </div>}
                <button className="button button-full" disabled={submitting}>{submitting ? "Please wait…" : isRegister ? "Create account" : "Log in"}</button>
            </form>
            <p className="auth-switch">{isRegister ? "Already registered?" : "New to SSCS?"} <Link to={isRegister ? "/login" : "/register"}>{isRegister ? "Log in" : "Create an account"}</Link></p>
        </div>
    </section>;
}

const loginPortals = {
    athlete: {
        title: "Athlete Portal",
        headline: "Your talent deserves to be seen.",
        description: "Showcase your sporting journey and connect with scouts through one athlete-first network.",
        highlights: [
            "Bring your profile and career history together",
            "Choose whether scouts can discover your profile",
            "Start conversations directly through SSCS",
        ],
        dashboardPath: "/athlete-dashboard",
    },
    scout: {
        title: "Scout & Agency Portal",
        headline: "Find talent. Make the connection.",
        description: "Explore athlete profiles, organize promising prospects, and connect from one scouting workspace.",
        highlights: [
            "Search across sports and locations",
            "Keep prospects organized in your shortlist",
            "Contact athletes through SSCS messaging",
        ],
        dashboardPath: "/scout-dashboard",
    },
    admin: {
        title: "Administrator Portal",
        headline: "Keep the network moving.",
        description: "Manage accounts, review profile requests, and respond to reports from one secure workspace.",
        highlights: [
            "Review athlete and agency profiles",
            "Manage account access",
            "Keep up with user-submitted reports",
        ],
        dashboardPath: "/admin",
    },
};

export function LoginPortalPage({ role }) {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [selectedRole, setSelectedRole] = useState(role || "athlete");
    const portal = loginPortals[selectedRole];
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [progressComplete, setProgressComplete] = useState(false);
    const [showResetRequest, setShowResetRequest] = useState(false);
    const [resetEmail, setResetEmail] = useState("");
    const [resetRequestMessage, setResetRequestMessage] = useState("");
    const [resetRequestError, setResetRequestError] = useState("");
    const [requestingReset, setRequestingReset] = useState(false);

    useEffect(() => {
        if (role) setSelectedRole(role);
    }, [role]);

    function selectRole(nextRole) {
        setSelectedRole(nextRole);
        setError("");
        navigate(`/login/${nextRole}/`, { replace: true });
    }

    async function submit(event) {
        event.preventDefault();
        setError("");
        setProgressComplete(false);
        setSubmitting(true);
        const startedAt = Date.now();
        let requestError;
        try {
            await login(email, password, selectedRole);
        } catch (error) {
            requestError = error;
        }
        const remaining = 2000 - (Date.now() - startedAt);
        if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
        setProgressComplete(true);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        setSubmitting(false);
        if (requestError) setError(requestError.message);
        else navigate(portal.dashboardPath, { replace: true });
    }

    async function submitResetRequest(event) {
        event.preventDefault();
        setResetRequestError("");
        setResetRequestMessage("");
        setRequestingReset(true);
        try {
            const result = await api("/auth/password-reset-requests", {
                method: "POST",
                body: { email: resetEmail },
            });
            setResetRequestMessage(result.message);
        } catch (requestError) {
            setResetRequestError(requestError.message);
        } finally {
            setRequestingReset(false);
        }
    }

    return <section className="portal-login">
        <div className="portal-hero">
            <div className="portal-art" aria-hidden="true">
                <div className="portal-art-orbit portal-art-orbit-outer" />
                <div className="portal-art-orbit portal-art-orbit-inner" />
                <div className="portal-art-ball"><span>S</span></div>
                <div className="portal-art-label">SSCS <span>·</span> THE TALENT NETWORK</div>
                <div className="portal-art-coordinate">DISCOVER <span>·</span> CONNECT <span>·</span> GROW</div>
            </div>
            <div className="portal-copy">
                <p className="portal-kicker"><span />SECURE SIGN IN</p>
                <h1>{portal.headline}</h1>
                <p className="portal-description">{portal.description}</p>
                <ul className="portal-highlights">
                    {portal.highlights.map((highlight) => <li key={highlight}><span aria-hidden="true">✓</span>{highlight}</li>)}
                </ul>
                <span className="portal-badge"><i />{portal.title}</span>
            </div>
        </div>
        {submitting && <AuthProgressBar label="Signing in" complete={progressComplete} />}
        <form onSubmit={submit} className="portal-form rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/10 sm:p-9">
            <div className="mb-7">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-700">{selectedRole === "athlete" ? "Athlete access" : selectedRole === "scout" ? "Scout & agency access" : "Administrator access"}</p>
                <h2 className="text-2xl font-bold text-slate-900">Log in to your account</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Use the email address and password associated with your SSCS account.</p>
            </div>
            <label className="portal-role-select mb-6 block text-sm font-semibold text-slate-700" htmlFor="login-role">
                I am logging in as
                <select
                    id="login-role"
                    name="loginRole"
                    value={selectedRole}
                    onChange={(event) => selectRole(event.target.value)}
                >
                    <option value="athlete">Athlete</option>
                    <option value="scout">Scout / Agency</option>
                    <option value="admin">Administrator</option>
                </select>
            </label>
            {error && <div className="mb-5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200" role="alert">{error}</div>}
            <label className="mb-5 block text-sm font-semibold text-slate-700">
                Email address
                <input
                    className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                />
            </label>
            <label className="mb-6 block text-sm font-semibold text-slate-700">
                Password
                <input
                    className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
                    name="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                />
            </label>
            <button type="submit" disabled={submitting} className="w-full rounded-xl bg-blue-400 px-5 py-3.5 font-bold text-slate-950 transition hover:bg-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 disabled:cursor-wait disabled:opacity-60">
                {submitting ? "Signing in…" : `Log in to ${portal.title}`}
            </button>
            <p className="mt-6 text-center text-sm text-slate-600">Need an account? <Link className="font-semibold text-blue-700 hover:text-blue-800" to="/register">Register here</Link></p>
        </form>
        <div className="portal-reset-options">
            <button
                type="button"
                onClick={() => {
                    setResetEmail(email);
                    setResetRequestMessage("");
                    setResetRequestError("");
                    setShowResetRequest((current) => !current);
                }}
            >
                Forgot your password? Request an admin-approved reset
            </button>
            <Link to="/reset-password">I already have a reset code</Link>
        </div>
        {showResetRequest && <form className="portal-reset-request" onSubmit={submitResetRequest}>
            <h2>Request a password reset</h2>
            <p>An administrator will review your request. If approved, they will share a one-time code with you through a trusted channel.</p>
            <label>
                Account email
                <input
                    type="email"
                    autoComplete="email"
                    value={resetEmail}
                    onChange={(event) => setResetEmail(event.target.value)}
                    required
                    maxLength={254}
                />
            </label>
            {resetRequestError && <p className="portal-reset-feedback is-error" role="alert">{resetRequestError}</p>}
            {resetRequestMessage && <p className="portal-reset-feedback" role="status">{resetRequestMessage}</p>}
            <button type="submit" disabled={requestingReset}>
                {requestingReset ? "Sending request…" : "Send reset request to admin"}
            </button>
        </form>}
    </section>;
}

export function PasswordResetPage() {
    const [values, setValues] = useState({ email: "", code: "", password: "", confirmPassword: "" });
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [submitting, setSubmitting] = useState(false);

    function update(event) {
        setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
    }

    async function submit(event) {
        event.preventDefault();
        setError("");
        setSuccess("");
        if (values.password !== values.confirmPassword) {
            setError("The passwords do not match.");
            return;
        }
        setSubmitting(true);
        try {
            const result = await api("/auth/password-reset", {
                method: "POST",
                body: { email: values.email, code: values.code, password: values.password },
            });
            setSuccess(result.message);
            setValues((current) => ({ ...current, code: "", password: "", confirmPassword: "" }));
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSubmitting(false);
        }
    }

    return <section className="password-reset-page">
        <div className="password-reset-card">
            <p className="portal-kicker"><span /> SECURE ACCOUNT RECOVERY</p>
            <h1>Set a new password</h1>
            <p>Enter the one-time code provided by an administrator. Codes expire after 30 minutes and can only be used once.</p>
            {error && <p className="portal-reset-feedback is-error" role="alert">{error}</p>}
            {success ? <div className="password-reset-success" role="status">
                <p>{success}</p>
                <Link to="/login">Return to sign in</Link>
            </div> : <form onSubmit={submit}>
                <label>
                    Account email
                    <input type="email" name="email" value={values.email} onChange={update} autoComplete="email" required maxLength={254} />
                </label>
                <label>
                    One-time reset code
                    <input name="code" value={values.code} onChange={update} autoComplete="one-time-code" autoCapitalize="none" spellCheck="false" required maxLength={64} />
                </label>
                <label>
                    New password
                    <input type="password" name="password" value={values.password} onChange={update} autoComplete="new-password" required minLength={10} maxLength={128} />
                </label>
                <label>
                    Confirm new password
                    <input type="password" name="confirmPassword" value={values.confirmPassword} onChange={update} autoComplete="new-password" required minLength={10} maxLength={128} />
                </label>
                <button type="submit" disabled={submitting}>{submitting ? "Updating password…" : "Set new password"}</button>
            </form>}
            <Link className="password-reset-back" to="/login">Back to sign in</Link>
        </div>
    </section>;
}

function DashboardNetworkVisual({ label, code = "SSCS / GLOBAL", icon = "S" }) {
    return <div className="dashboard-network-visual" aria-hidden="true">
        <span className="dashboard-globe-orbit dashboard-globe-orbit-outer" />
        <span className="dashboard-globe-orbit dashboard-globe-orbit-inner" />
        <span className="dashboard-globe-grid" />
        <span className="dashboard-globe-core">{icon}</span>
        <span className="dashboard-globe-node dashboard-globe-node-one" />
        <span className="dashboard-globe-node dashboard-globe-node-two" />
        <span className="dashboard-globe-node dashboard-globe-node-three" />
        <span className="dashboard-globe-label dashboard-globe-label-top"><i />{label}</span>
        <span className="dashboard-globe-label dashboard-globe-label-bottom">{code}</span>
    </div>;
}

export function AthleteDashboardPage() {
    const { user } = useAuth();
    const [networkStats, setNetworkStats] = useState(null);
    const [dashboardError, setDashboardError] = useState("");

    useEffect(() => {
        Promise.all([api("/public/summary"), api("/messages/unread")])
            .then(([summary, inbox]) => setNetworkStats({ ...summary, unread: inbox.unreadCount }))
            .catch((requestError) => setDashboardError(requestError.message));
    }, []);

    return <section className="athlete-dashboard-page">
        <header className="athlete-welcome-panel">
            <div className="athlete-welcome-copy">
                <p className="athlete-kicker"><span /> YOUR PLACE IN THE GLOBAL GAME</p>
                <h1>Talent has<br />no <span>boundaries.</span></h1>
                <p>Step into a connected sporting world. Put your journey in front of scouts and organizations wherever opportunity is growing.</p>
                <div className="athlete-welcome-actions">
                    <Link className="button" to="/profile">Make your profile stand out <span aria-hidden="true">→</span></Link>
                    <Link className="athlete-text-link" to="/agencies">Discover global organizations <span aria-hidden="true">↗</span></Link>
                </div>
            </div>
            <DashboardNetworkVisual label="GLOBAL TALENT NETWORK" code="ATHLETE / ONLINE" />
            <span className="athlete-hero-index" aria-hidden="true">SSCS · 01</span>
        </header>

        <ErrorNotice error={dashboardError} />
        <div className="dashboard-signal-strip" aria-label="Your network snapshot">
            <div className="dashboard-signal-item"><span className="dashboard-signal-icon">◎</span><span><small>ATHLETES IN THE NETWORK</small><strong>{networkStats?.athlete_count ?? "—"}</strong></span></div>
            <div className="dashboard-signal-item"><span className="dashboard-signal-icon">⌂</span><span><small>ORGANIZATIONS</small><strong>{networkStats?.agency_count ?? "—"}</strong></span></div>
            <div className="dashboard-signal-item"><span className="dashboard-signal-icon">⌁</span><span><small>UNREAD CONNECTIONS</small><strong>{networkStats?.unread ?? "—"}</strong></span></div>
            <span className="dashboard-signal-live"><i /> NETWORK STATUS / CONNECTED</span>
        </div>

        <div className="athlete-dashboard-heading">
            <div>
                <p className="athlete-kicker"><span /> YOUR GLOBAL WORKSPACE</p>
                <h2>Move your journey forward.</h2>
            </div>
            <p>Build your sporting identity, connect with the network, and stay ready for what comes next.</p>
        </div>

        <div className="athlete-dashboard-links">
            <Link to="/profile" className="athlete-dashboard-card athlete-dashboard-card-featured">
                <span className="athlete-card-topline"><span>01 / YOUR STORY</span><span className="athlete-card-icon" aria-hidden="true">◉</span></span>
                <span className="athlete-card-title">Athlete profile</span>
                <span className="athlete-card-description">Show scouts your sporting history, performance details, and what makes you different.</span>
                <span className="athlete-card-link">Build your profile <span aria-hidden="true">↗</span></span>
                <span className="athlete-card-watermark" aria-hidden="true">01</span>
            </Link>
            <Link to="/inbox" className="athlete-dashboard-card">
                <span className="athlete-card-topline"><span>02 / CONNECTIONS</span><span className="athlete-card-icon" aria-hidden="true">⌁</span></span>
                <span className="athlete-card-title">Messages</span>
                <span className="athlete-card-description">Keep up with scouts and agencies reaching out through the SSCS network.</span>
                <span className="athlete-card-link">Open your inbox <span aria-hidden="true">↗</span></span>
                <span className="athlete-card-watermark" aria-hidden="true">02</span>
            </Link>
            <Link to="/agencies" className="athlete-dashboard-card">
                <span className="athlete-card-topline"><span>03 / DISCOVER</span><span className="athlete-card-icon" aria-hidden="true">⌕</span></span>
                <span className="athlete-card-title">Agency network</span>
                <span className="athlete-card-description">Explore organizations and discover where your next opportunity could begin.</span>
                <span className="athlete-card-link">Browse agencies <span aria-hidden="true">↗</span></span>
                <span className="athlete-card-watermark" aria-hidden="true">03</span>
            </Link>
        </div>
    </section>;
}

export function ScoutDashboardPage() {
    const { user } = useAuth();
    const [scoutStats, setScoutStats] = useState(null);
    const [dashboardError, setDashboardError] = useState("");

    useEffect(() => {
        Promise.all([api("/public/summary"), api("/shortlist"), api("/messages/unread")])
            .then(([summary, { shortlist }, inbox]) => setScoutStats({
                athletes: summary.athlete_count,
                agencies: summary.agency_count,
                shortlist: shortlist.length,
                unread: inbox.unreadCount,
            }))
            .catch((requestError) => setDashboardError(requestError.message));
    }, []);

    return <section className="role-dashboard-page scout-network-dashboard">
        <header className="role-dashboard-hero">
            <div className="role-dashboard-copy">
                <p className="role-dashboard-kicker"><span /> GLOBAL SCOUTING / {user.username.toUpperCase()}</p>
                <h1>Find potential.<br /><span>From anywhere.</span></h1>
                <p>Search a connected world of sporting talent. Build your pipeline, follow promising prospects, and turn discovery into opportunity.</p>
                <div className="role-dashboard-actions">
                    <Link className="button" to="/athletes">Explore athlete network <span aria-hidden="true">↗</span></Link>
                    <Link className="role-dashboard-secondary-link" to="/shortlist">Open talent shortlist <span aria-hidden="true">→</span></Link>
                </div>
            </div>
            <DashboardNetworkVisual label="SCOUTING / WORLDWIDE" code="DISCOVER · CONNECT" icon="⌕" />
            <span className="role-dashboard-index" aria-hidden="true">SSCS / 02</span>
        </header>
        <ErrorNotice error={dashboardError} />
        <div className="dashboard-signal-strip" aria-label="Scouting workspace snapshot">
            <div className="dashboard-signal-item"><span className="dashboard-signal-icon">◎</span><span><small>ATHLETES TO DISCOVER</small><strong>{scoutStats?.athletes ?? "—"}</strong></span></div>
            <div className="dashboard-signal-item"><span className="dashboard-signal-icon">☆</span><span><small>YOUR SHORTLIST</small><strong>{scoutStats?.shortlist ?? "—"}</strong></span></div>
            <div className="dashboard-signal-item"><span className="dashboard-signal-icon">⌁</span><span><small>UNREAD MESSAGES</small><strong>{scoutStats?.unread ?? "—"}</strong></span></div>
            <span className="dashboard-signal-live"><i /> SCOUTING NETWORK / LIVE</span>
        </div>
        <div className="role-dashboard-section-heading">
            <div><p className="role-dashboard-kicker"><span /> YOUR SCOUTING OPERATIONS</p><h2>From discovery to connection.</h2></div>
            <p>A focused command deck for every step of your recruitment workflow.</p>
        </div>
        <div className="role-dashboard-actions-grid">
            <Link to="/athletes" className="role-dashboard-action role-dashboard-action-featured"><span className="role-action-topline">01 / DISCOVER TALENT<span>⌕</span></span><strong>Find athletes</strong><span>Search across sports, locations, and disciplines to surface new prospects.</span><span className="role-action-link">Explore athlete profiles <b>↗</b></span></Link>
            <Link to="/shortlist" className="role-dashboard-action"><span className="role-action-topline">02 / BUILD YOUR PIPELINE<span>☆</span></span><strong>Talent shortlist</strong><span>Keep promising prospects together and return to your saved talent.</span><span className="role-action-link">Review shortlist <b>↗</b></span></Link>
            <Link to="/inbox" className="role-dashboard-action"><span className="role-action-topline">03 / MAKE CONTACT<span>⌁</span></span><strong>Conversations</strong><span>Continue discussions and follow up with people in your network.</span><span className="role-action-link">Open communications <b>↗</b></span></Link>
            <Link to="/profile" className="role-dashboard-action"><span className="role-action-topline">04 / YOUR ORGANIZATION<span>◉</span></span><strong>Agency presence</strong><span>Keep your organization details ready for athletes and partners.</span><span className="role-action-link">Manage your profile <b>↗</b></span></Link>
        </div>
    </section>;
}

export function AthleteSearchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [filters, setFilters] = useState({
        sport: searchParams.get("sport") || "",
        position: searchParams.get("position") || "",
        age: searchParams.get("age") || "",
        location: searchParams.get("location") || "",
        competitionLevel: searchParams.get("competitionLevel") || "",
    });
    const [athletes, setAthletes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [flash, setFlash] = useState("");
    const [shortlistIds, setShortlistIds] = useState(new Set());

    const loadAthletes = useCallback(async (parameters) => {
        setLoading(true);
        setError("");
        try {
            const query = new URLSearchParams(Object.entries(parameters).filter(([, value]) => value));
            const [{ athletes: records }, { shortlist }] = await Promise.all([
                api(`/athletes?${query}`),
                api("/shortlist"),
            ]);
            setAthletes(records);
            setShortlistIds(new Set(shortlist.map((record) => String(record.id))));
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAthletes(filters); }, []);

    function update(event) {
        setFilters((current) => ({ ...current, [event.target.name]: event.target.value }));
    }

    async function submit(event) {
        event.preventDefault();
        setSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
        await loadAthletes(filters);
    }

    async function shortlist(athlete) {
        try {
            await api(`/shortlist/${athlete.id}`, { method: "POST" });
            setShortlistIds((current) => new Set([...current, String(athlete.id)]));
            setFlash(`${athlete.first_name} ${athlete.last_name} added to your shortlist.`);
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    return <>
        <PageIntro eyebrow="SCOUTING WORKSPACE" title="Find your next athlete" description="Search across sports and shortlist promising talent for your agency." action={<Link className="button button-outline" to="/shortlist">View shortlist →</Link>} />
        <SuccessNotice>{flash}</SuccessNotice><ErrorNotice error={error} />
        <form className="filter-panel" onSubmit={submit}>
            <div className="filter-grid">
                <Field label="Sport / discipline" name="sport" value={filters.sport} onChange={update} placeholder="Any sport" />
                <Field label="Position / event" name="position" value={filters.position} onChange={update} placeholder="Any position" />
                <Field label="Age" name="age" type="number" value={filters.age} onChange={update} min={0} max={125} placeholder="Any age" />
                <Field label="Geographical location" name="location" value={filters.location} onChange={update} placeholder="Any location" />
                <label className="form-field">
                    <span>Competition level</span>
                    <select name="competitionLevel" value={filters.competitionLevel} onChange={update}>
                        <option value="">Any level</option>
                        <option value="Club">Club</option>
                        <option value="Regional">Regional</option>
                        <option value="National">National</option>
                        <option value="International">International</option>
                    </select>
                </label>
            </div>
            <div className="filter-actions"><button className="button">Search athletes</button><button className="button button-quiet" type="button" onClick={() => { const empty = { sport: "", position: "", age: "", location: "", competitionLevel: "" }; setFilters(empty); setSearchParams({}); loadAthletes(empty); }}>Clear filters</button></div>
        </form>
        <div className="results-heading"><div><p className="eyebrow">TALENT DISCOVERY</p><h2>{loading ? "Searching…" : `${athletes.length} athlete${athletes.length === 1 ? "" : "s"} found`}</h2></div></div>
        {loading ? <PageLoading /> : <div className="athlete-grid">
            {athletes.map((athlete) => <AthleteCard key={athlete.id} athlete={athlete} shortlisted={shortlistIds.has(String(athlete.id))} onShortlist={shortlist} />)}
            {athletes.length === 0 && <EmptyState title="No athletes match those filters" action={<button className="button button-outline" onClick={() => { const empty = { sport: "", position: "", age: "", location: "", competitionLevel: "" }; setFilters(empty); setSearchParams({}); loadAthletes(empty); }}>Browse all athletes</button>}>Try changing your criteria, or clear filters to browse all registered profiles.</EmptyState>}
        </div>}
    </>;
}

export function AthleteDetailPage() {
    const { id } = useParams();
    const { user } = useAuth();
    const [athlete, setAthlete] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [shortlisted, setShortlisted] = useState(false);

    useEffect(() => {
        Promise.all([api(`/athletes/${id}`), user?.role === "scout" ? api("/shortlist") : Promise.resolve({ shortlist: [] })])
            .then(([profile, list]) => {
                setAthlete(profile.athlete);
                setShortlisted(list.shortlist.some((item) => String(item.id) === String(id)));
            })
            .catch((requestError) => setError(requestError.message))
            .finally(() => setLoading(false));
    }, [id, user?.role]);

    async function addShortlist() {
        try {
            await api(`/shortlist/${id}`, { method: "POST" });
            setShortlisted(true);
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    if (loading) return <PageLoading />;
    if (error) return <ErrorNotice error={error} />;
    if (!athlete) return null;
    const isProfileOwner = user?.id != null && String(athlete.user_id) === String(user.id);

    return <>
        <Link className="back-link" to={isProfileOwner ? "/profile" : "/athletes"}>{isProfileOwner ? "← Back to my profile" : "← Back to athlete search"}</Link>
        <ErrorNotice error={error} />
        <section className="athlete-profile-page">
            <header className="athlete-spotlight">
                <div className="spotlight-orbit spotlight-orbit-one" />
                <div className="spotlight-orbit spotlight-orbit-two" />
                <div className="spotlight-content">
                    <p className="spotlight-kicker"><span className="live-dot" /> SSCS ATHLETE DOSSIER</p>
                    <span className="spotlight-sport">{athlete.sport}</span>
                        <h1><span className="spotlight-first-name">{athlete.first_name}</span><span className="spotlight-last-name">{athlete.last_name}</span></h1>
                        {athlete.verification_status === "verified" && <span className="spotlight-review-status"><span aria-hidden="true">✓</span> ADMIN REVIEWED PROFILE</span>}
                        <p className="spotlight-position"><span className="spotlight-role">{athlete.position}</span>{athlete.location && <><span className="spotlight-position-divider" aria-hidden="true">·</span><span className="spotlight-location">{athlete.location}</span></>}</p>
                    {athlete.bio && <p className="spotlight-bio">{athlete.bio}</p>}
                    <div className="spotlight-facts">
                        <div><span>AGE</span><strong>{athlete.age ?? "—"}</strong></div>
                        <div><span>DISCIPLINE</span><strong>{athlete.sport}</strong></div>
                        <div><span>LEVEL</span><strong>{athlete.competition_level || "—"}</strong></div>
                        <div><span>CAREER ENTRIES</span><strong>{athlete.career_history?.length ?? 0}</strong></div>
                    </div>
                </div>
                <div className="spotlight-portrait">
                    <PhotoAvatar
                        userId={athlete.user_id}
                        initials={`${athlete.first_name[0]}${athlete.last_name[0]}`}
                        hasPhoto={athlete.has_profile_photo}
                        className="spotlight-mark"
                        alt={`${athlete.first_name} ${athlete.last_name} profile photo`}
                    />
                    <div className="spotlight-portrait-caption"><span>PLAYER PROFILE</span><b>SSCS / {String(athlete.id).padStart(3, "0")}</b></div>
                </div>
            </header>

            <div className="profile-content-grid">
                <article className="detail-card athlete-details-card">
                <div className="profile-section-heading"><p className="eyebrow">CAREER & DEVELOPMENT</p><h2>Career progression.</h2></div>
                <section className="detail-section profile-career-section"><h2>Career history</h2>
                    {athlete.career_history?.length ? <div className="career-list">{athlete.career_history.map((item, index) => <article className="career-item" key={`${item.team}-${index}`}><span className="career-dot"></span><div><h3>{item.team}</h3><p>{[item.period, item.competition].filter(Boolean).join(" · ")}</p>{item.notes && <small>{item.notes}</small>}</div></article>)}</div> : <p className="muted">No career history has been added.</p>}
                </section>
                <section className="detail-section profile-performance-section"><div className="profile-section-heading"><p className="eyebrow">ON THE NUMBERS</p><h2>Performance snapshot</h2></div>
                    {athlete.performance_stats && Object.keys(athlete.performance_stats).length ? <div className="stats-list">{Object.entries(athlete.performance_stats).map(([label, value], index) => <div className="performance-stat" key={label}><span className="performance-stat-index">{String(index + 1).padStart(2, "0")}</span><span>{label}</span><strong>{String(value)}</strong></div>)}</div> : <p className="muted">No performance statistics have been added yet.</p>}
                </section>
                {athlete.video_link && <a className="button button-outline profile-highlight-link" href={athlete.video_link} target="_blank" rel="noopener noreferrer"><span className="highlight-play">▶</span> Watch athlete highlights <span aria-hidden="true">↗</span></a>}
                </article>
                <aside className="detail-aside scout-action-card"><p className="eyebrow">{isProfileOwner ? "YOUR PLAYER PROFILE" : "SCOUTING ACTION"}</p><span className="scout-action-mark" aria-hidden="true">↗</span><h2>{isProfileOwner ? "Your next chapter starts here." : "Make the right connection."}</h2><p>{isProfileOwner ? "Keep your sporting journey current and ready for the next opportunity." : "Add this athlete to your shortlist or start a direct conversation to explore a potential fit."}</p>
                {isProfileOwner && <Link className="button button-full" to="/profile">Edit your profile <span aria-hidden="true">↗</span></Link>}
                {!isProfileOwner && user?.role === "scout" && <button className={`button button-full ${shortlisted ? "button-saved" : ""}`} onClick={addShortlist}>{shortlisted ? "✓ On your shortlist" : "+ Add to shortlist"}</button>}
                {!isProfileOwner && <Link className={`button button-outline button-full ${user?.role === "scout" ? "space-top" : ""}`} to={`/messages/new/${athlete.user_id}`}>Start a conversation <span aria-hidden="true">↗</span></Link>}
            </aside>
            </div>
        </section>
    </>;
}

export function ProfilePage() {
    const { user, setProfilePhoto } = useAuth();
    const [profile, setProfile] = useState(null);
    const [profileType, setProfileType] = useState("");
    const [values, setValues] = useState({});
    const [savedValues, setSavedValues] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [verificationSubmitting, setVerificationSubmitting] = useState(false);
    const [visibilitySaving, setVisibilitySaving] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [photoVersion, setPhotoVersion] = useState(0);
    const [photoPreview, setPhotoPreview] = useState("");
    const [photoUploading, setPhotoUploading] = useState(false);
    const [pendingPhoto, setPendingPhoto] = useState(null);
    const [photoUploadError, setPhotoUploadError] = useState("");

    useEffect(() => {
        if (!photoPreview) return undefined;
        return () => URL.revokeObjectURL(photoPreview);
    }, [photoPreview]);

    useEffect(() => {
        api("/me/profile").then(({ profile: current, profileType: type }) => {
            setProfile(current);
            setProfileType(type);
            const initialValues = profileFormValues(type, current);
            setValues(initialValues);
            setSavedValues(initialValues);
        }).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
    }, []);

    const hasUnsavedChanges = savedValues !== null && !profileFormValuesEqual(values, savedValues);

    function update(event) {
        setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
    }

    async function uploadPhotoFile(file) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            setPhotoUploadError("Choose a JPEG, PNG, or WebP profile photo.");
            return;
        }
        if (file.size > 3 * 1024 * 1024) {
            setPhotoUploadError("Profile photos must be 3 MB or smaller.");
            return;
        }

        setError("");
        setPhotoUploadError("");
        setSuccess("");
        setPhotoPreview(URL.createObjectURL(file));
        setPendingPhoto(file);
        setPhotoUploading(true);
        try {
            await api("/me/profile-photo", {
                method: "POST",
                body: file,
                headers: { "Content-Type": file.type },
            });
            setPhotoVersion((version) => version + 1);
            setProfile((current) => ({ ...current, has_profile_photo: true }));
            setProfilePhoto(true);
            setPhotoPreview("");
            setPendingPhoto(null);
            setSuccess("Profile photo updated.");
        } catch (requestError) {
            setPhotoUploadError(requestError.message);
            setError(requestError.message);
        } finally {
            setPhotoUploading(false);
        }
    }

    function uploadPhoto(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void uploadPhotoFile(file);
    }

    async function removePhoto() {
        setError("");
        setSuccess("");
        setPhotoUploading(true);
        try {
            await api("/me/profile-photo", { method: "DELETE" });
            setPhotoVersion((version) => version + 1);
            setProfile((current) => ({ ...current, has_profile_photo: false }));
            setProfilePhoto(false);
            setPhotoPreview("");
            setPendingPhoto(null);
            setPhotoUploadError("");
            setSuccess("Profile photo removed.");
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setPhotoUploading(false);
        }
    }

    async function save(event) {
        event.preventDefault();
        if (!profile || !hasUnsavedChanges || saving) return;
        setError("");
        setSuccess("");
        const submittedValues = { ...values };
        const reviewNeedsRenewal = ["pending", "verified", "rejected"].includes(profile.verification_status);
        setSaving(true);
        try {
            let nextProfile;
            if (profileType === "athlete") {
                let performanceStats;
                try {
                    performanceStats = JSON.parse(submittedValues.performanceStatsText || "{}");
                } catch {
                    throw new Error("Performance information must be valid JSON.");
                }
                const result = await api("/me/athlete-profile", { method: "PATCH", body: {
                    firstName: submittedValues.firstName, lastName: submittedValues.lastName, sport: submittedValues.sport,
                    position: submittedValues.position, age: submittedValues.age || null, location: submittedValues.location,
                    competitionLevel: submittedValues.competitionLevel,
                    bio: submittedValues.bio, videoLink: submittedValues.videoLink,
                    careerHistory: parseCareerText(submittedValues.careerHistoryText), performanceStats,
                } });
                nextProfile = result.athlete;
            } else {
                const result = await api("/me/agency-profile", { method: "PATCH", body: {
                    agencyName: submittedValues.agencyName, country: submittedValues.country,
                    contactPhone: submittedValues.contactPhone, contactDetails: submittedValues.contactDetails,
                } });
                nextProfile = result.agency;
            }
            const nextSavedValues = profileFormValues(profileType, nextProfile);
            setProfile((current) => ({ ...nextProfile, has_profile_photo: current?.has_profile_photo }));
            setSavedValues(nextSavedValues);
            setValues((current) => profileFormValuesEqual(current, submittedValues) ? nextSavedValues : current);
            const profileChanged = !profileFormValuesEqual(nextSavedValues, savedValues);
            setSuccess(!profileChanged
                ? "No profile changes were detected. Your review status is unchanged."
                : reviewNeedsRenewal && nextProfile.verification_status === "unverified"
                    ? "Profile saved. Your previous review was cleared; request a new admin review to restore the badge."
                    : "Profile saved successfully. Request an admin review when your profile is ready.");
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    async function requestVerification() {
        setError("");
        setSuccess("");
        setVerificationSubmitting(true);
        try {
            const { verification } = await api("/me/verification-request", { method: "POST" });
            setProfile((current) => ({ ...current, ...verification }));
            setSuccess("Your profile review request has been submitted.");
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setVerificationSubmitting(false);
        }
    }

    async function updateDiscoverability(event) {
        const isDiscoverable = event.target.checked;
        setError("");
        setVisibilitySaving(true);
        try {
            const result = await api("/me/athlete-visibility", {
                method: "PATCH",
                body: { isDiscoverable },
            });
            setProfile((current) => ({ ...current, is_discoverable: result.isDiscoverable }));
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setVisibilitySaving(false);
        }
    }

    if (loading) return <PageLoading />;
    if (!profile) return <ErrorNotice error={error || "Profile not found."} />;

    const profileName = profileType === "admin"
        ? user.username
        : profileType === "athlete"
            ? `${values.firstName || "Your name"} ${values.lastName || ""}`.trim()
            : values.agencyName || "Your organization";
    const profileSubtitle = profileType === "admin"
        ? "SSCS administrator account"
        : profileType === "athlete"
            ? [values.sport || "Choose your sport", values.position || "Add your discipline"].join(" / ")
            : [values.country || "Add your country", "Sports organization"].join(" / ");
    const profileInitials = profileType === "athlete"
        ? `${values.firstName?.[0] || "A"}${values.lastName?.[0] || ""}`
        : (values.agencyName?.[0] || user.username[0]).toUpperCase();
    const careerEntryCount = profileType === "athlete"
        ? parseCareerText(values.careerHistoryText || "").length
        : 0;

    return <section className={`profile-edit-page${profileType === "athlete" ? " is-athlete-profile" : ""}`}>
        <header className={`profile-edit-hero${profileType === "athlete" ? " athlete-spotlight profile-edit-athlete-preview" : ""}`}>
            {profileType === "athlete" ? <>
                <div className="spotlight-content">
                    <p className="spotlight-kicker"><span className="live-dot" /> SSCS ATHLETE DOSSIER <span className="profile-preview-mode">EDIT PREVIEW</span></p>
                    <span className="spotlight-sport">{values.sport || "Choose your sport"}</span>
                    <h1><span className="spotlight-first-name">{values.firstName || "Your name"}</span>{values.lastName && <span className="spotlight-last-name">{values.lastName}</span>}</h1>
                    {profile.verification_status === "verified" && <span className="spotlight-review-status"><span aria-hidden="true">✓</span> ADMIN REVIEWED PROFILE</span>}
                    <p className="spotlight-position"><span className="spotlight-role">{values.position || "Add your discipline"}</span>{values.location && <><span className="spotlight-position-divider" aria-hidden="true">·</span><span className="spotlight-location">{values.location}</span></>}</p>
                    {values.bio && <p className="spotlight-bio">{values.bio}</p>}
                    <div className="spotlight-facts">
                        <div><span>AGE</span><strong>{values.age === "" ? "—" : values.age}</strong></div>
                        <div><span>DISCIPLINE</span><strong>{values.sport || "—"}</strong></div>
                        <div><span>LEVEL</span><strong>{values.competitionLevel || "—"}</strong></div>
                        <div><span>CAREER ENTRIES</span><strong>{careerEntryCount}</strong></div>
                    </div>
                </div>
                <div className="spotlight-portrait">
                    <PhotoAvatar
                        userId={user.id}
                        initials={profileInitials}
                        hasPhoto={profile.has_profile_photo}
                        preview={photoPreview}
                        version={photoVersion}
                        className="spotlight-mark"
                        alt="Your profile photo preview"
                    />
                    <div className="spotlight-portrait-caption"><span>PLAYER PROFILE</span><b>SSCS / {String(profile.id).padStart(3, "0")}</b></div>
                </div>
            </> : <>
                <div className="profile-edit-hero-copy">
                    <p className="profile-edit-kicker"><span /> YOUR GLOBAL NETWORK IDENTITY</p>
                    <h1>Make your mark<br /><span>on the world stage.</span></h1>
                    <p>Your profile is your introduction to the SSCS network. Keep your story, details, and sporting identity ready to be discovered.</p>
                </div>
                <DashboardNetworkVisual label="PROFILE / NETWORK READY" code="AGENCY PRESENCE" />
                <span className="profile-edit-hero-index" aria-hidden="true">SSCS / PROFILE</span>
            </>}
        </header>

        <div className="profile-edit-card">
            {profileType !== "athlete" && <div className="profile-editor-banner">
                <PhotoAvatar
                    userId={user.id}
                    initials={profileInitials}
                    hasPhoto={profile.has_profile_photo}
                    preview={photoPreview}
                    version={photoVersion}
                    className="profile-editor-orbit"
                    alt="Your profile photo"
                />
                <div><p className="eyebrow">ORGANIZATION PROFILE</p><h2>{profileName}<VerifiedAccountTick status={profile.verification_status} /></h2><p>{profileSubtitle}</p></div>
                <span className="profile-editor-live"><span className="live-dot" /> PROFILE EDITOR</span>
                <span className="profile-editor-index" aria-hidden="true">02</span>
            </div>}
            <div className="profile-owner">
                <span className="profile-owner-icon" aria-hidden="true">◉</span>
                <div className="profile-owner-identity"><strong>{user.username}</strong><span>{profileType === "admin" ? "ADMINISTRATOR ACCOUNT" : profileType === "athlete" ? "ATHLETE ACCOUNT" : "SCOUT & AGENCY ACCOUNT"}</span></div>
                <div className="profile-photo-actions">
                    <label className="button button-outline button-compact profile-photo-control">
                        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} disabled={photoUploading} />
                        {photoUploading ? "Uploading…" : profile.has_profile_photo ? "Change photo" : "Upload photo"}
                    </label>
                    {pendingPhoto && photoUploadError && <button className="button button-quiet button-compact" type="button" onClick={() => uploadPhotoFile(pendingPhoto)} disabled={photoUploading}>Retry upload</button>}
                    {profile.has_profile_photo && <button className="button button-quiet button-compact" type="button" onClick={removePhoto} disabled={photoUploading}>Remove</button>}
                </div>
                <Link className="text-action profile-preview-link" to={profileType === "athlete" ? `/athletes/${profile.id}` : `/agencies/${profile.id}`}>Preview profile →</Link>
            </div>
            <section className={`profile-verification-panel is-${profile.verification_status || "unverified"}`} aria-labelledby="profile-verification-title">
                <div>
                    <p className="eyebrow">PROFILE TRUST</p>
                    <h3 id="profile-verification-title">
                        {profileType === "admin"
                            ? "Verification not required"
                            : profile.verification_status === "verified"
                            ? <VerificationBadge status={profile.verification_status} />
                            : profile.verification_status === "pending" ? "Review requested" :
                                profile.verification_status === "rejected" ? "Review not approved" : "Not yet reviewed"}
                    </h3>
                    <p>{profileType === "admin"
                        ? "Administrator accounts are trusted system roles and do not require profile approval or verification."
                        : "An SSCS administrator reviews the profile details, but this does not independently verify sporting claims. Saving actual profile changes resets a previous review; you can then request another review."}</p>
                    {profile.verification_reviewed_at && <small>Last reviewed {formatDate(profile.verification_reviewed_at)}</small>}
                </div>
                {profileType !== "admin" && (profile.verification_status === "unverified" || profile.verification_status === "rejected") &&
                    <button className="button button-outline" type="button" onClick={requestVerification} disabled={verificationSubmitting}>
                        {verificationSubmitting ? "Submitting…" : profile.verification_status === "rejected" ? "Request another review" : "Request profile review"}
                    </button>}
                {profile.verification_status === "pending" && <span className="verification-pending-note">Your request is waiting for admin review.</span>}
            </section>
            {profileType === "athlete" && <div className="profile-visibility-control">
                <label>
                    <input
                        type="checkbox"
                        checked={Boolean(profile.is_discoverable)}
                        onChange={updateDiscoverability}
                        disabled={visibilitySaving}
                    />
                    <span>
                        <strong>{profile.is_discoverable ? "Discoverable to verified Scouts/Agencies" : "Hidden from Scout/Agency discovery"}</strong>
                        <small>{profile.is_discoverable
                            ? "Only administrator-reviewed Scout/Agency accounts can find or view this profile."
                            : "Only you and administrators can open this athlete profile."}</small>
                    </span>
                </label>
                {visibilitySaving && <span className="profile-visibility-saving">Saving…</span>}
            </div>}
            <div className="profile-form-layout">
                <div className="profile-form-main">
                    <div className="profile-form-heading">
                        <div><p className="profile-edit-kicker"><span /> PROFILE CONFIGURATION</p><h2>{profileType === "athlete" ? "Your sporting identity." : "Tell your story."}</h2><p>{profileType === "athlete" ? "Keep your athlete details, career history, and performance record accurate and ready to be discovered." : "These details help people across the network understand who you are and what you bring."}</p></div>
                        <span className="profile-form-shield" aria-hidden="true">✳</span>
                    </div>
                    {photoUploadError && <p className="photo-upload-error" role="alert">{photoUploadError} The preview is temporary until the upload succeeds.</p>}
                    <ErrorNotice error={error} /><SuccessNotice>{success}</SuccessNotice>
                    <form onSubmit={save}>
                {profileType === "athlete" ? <>
                    <section className="profile-input-section" aria-labelledby="athlete-identity-heading">
                        <h3 className="profile-form-section-title" id="athlete-identity-heading"><span>01</span> Athletic identity</h3>
                        <div className="form-grid two-col">
                            <Field label="First name" name="firstName" value={values.firstName || ""} onChange={update} required />
                            <Field label="Last name" name="lastName" value={values.lastName || ""} onChange={update} required />
                            <SportField name="sport" value={values.sport || ""} onChange={update} required />
                            <PositionField name="position" sport={values.sport || ""} value={values.position || ""} onChange={update} required />
                            <Field label="Age" name="age" type="number" value={values.age ?? ""} onChange={update} min={0} max={125} />
                            <Field label="Geographical location" name="location" value={values.location || ""} onChange={update} required />
                            <label className="form-field">
                                <span>Highest competition level</span>
                                <select name="competitionLevel" value={values.competitionLevel || ""} onChange={update}>
                                    <option value="">Select level</option>
                                    <option value="Club">Club</option>
                                    <option value="Regional">Regional</option>
                                    <option value="National">National</option>
                                    <option value="International">International</option>
                                </select>
                            </label>
                        </div>
                    </section>
                    <section className="profile-input-section" aria-labelledby="athlete-story-heading">
                        <div className="profile-story-heading">
                            <h3 className="profile-form-section-title" id="athlete-story-heading"><span>02</span> Your story</h3>
                            <p>Give scouts a clear sense of who you are, what you have achieved, and how to see you in action.</p>
                        </div>
                        <div className="profile-input-fields profile-story-fields">
                            <div className="profile-story-bio">
                                <TextArea
                                    label="Bio"
                                    name="bio"
                                    value={values.bio || ""}
                                    onChange={update}
                                    rows={5}
                                    maxLength={5000}
                                    placeholder="Introduce your playing style, strengths, ambitions, or sporting journey."
                                    aria-describedby="athlete-story-bio-help"
                                />
                                <div className="profile-story-meta" id="athlete-story-bio-help">
                                    <span>Keep it personal, focused, and useful to a scout.</span>
                                    <span className="profile-story-character-count">{(values.bio || "").length} / 5000</span>
                                </div>
                            </div>
                            <div className="profile-story-video-card">
                                <div className="profile-story-video-mark" aria-hidden="true">▶</div>
                                <div className="profile-story-video-content">
                                    <p className="profile-story-eyebrow">OPTIONAL HIGHLIGHT</p>
                                    <p className="profile-story-video-copy">Add a public video link so scouts can watch your game in action.</p>
                                    <Field
                                        label="Highlight video URL"
                                        name="videoLink"
                                        type="url"
                                        value={values.videoLink || ""}
                                        onChange={update}
                                        placeholder="https://…"
                                        aria-describedby="athlete-story-video-help"
                                    />
                                    <small id="athlete-story-video-help">Your profile will show a link to the video. SSCS does not host video files.</small>
                                </div>
                            </div>
                            <div className="profile-story-career">
                                <TextArea
                                    label="Career history"
                                    name="careerHistoryText"
                                    value={values.careerHistoryText || ""}
                                    onChange={update}
                                    rows={5}
                                    placeholder={"Kampala City FC | 2022–2025 | Premier League | Team captain"}
                                    aria-describedby="athlete-story-career-help"
                                />
                                <div className="profile-story-career-help" id="athlete-story-career-help">
                                    <span>Add one entry per line and separate details with <code>|</code>.</span>
                                    <div className="profile-story-format" aria-label="Career history format">
                                        <span>Club or team</span><i aria-hidden="true" />
                                        <span>Years</span><i aria-hidden="true" />
                                        <span>Competition</span><i aria-hidden="true" />
                                        <span>Role or notes</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                    <section className="profile-input-section" aria-labelledby="athlete-performance-heading">
                        <h3 className="profile-form-section-title" id="athlete-performance-heading"><span>03</span> Performance data</h3>
                        <div className="profile-input-fields">
                            <PerformanceStatsField id="profile-performance-stats" name="performanceStatsText" value={values.performanceStatsText || "{}"} onChange={update} />
                        </div>
                    </section>
                </> : <>
                    <h3 className="profile-form-section-title"><span>01</span> Organization identity</h3>
                    <div className="form-grid two-col">
                        <Field label="Agency name" name="agencyName" value={values.agencyName || ""} onChange={update} required />
                        <Field label="Country" name="country" value={values.country || ""} onChange={update} required />
                        <Field label="Contact phone" name="contactPhone" type="tel" value={values.contactPhone || ""} onChange={update} />
                    </div>
                    <h3 className="profile-form-section-title"><span>02</span> Contact information</h3>
                    <TextArea label="Contact details" name="contactDetails" value={values.contactDetails || ""} onChange={update} rows={4} />
                </>}
                        <div className="profile-save-row"><span className={`profile-save-status${hasUnsavedChanges ? " is-dirty" : " is-saved"}`} role="status"><i /> {hasUnsavedChanges ? "You have unsaved profile changes" : "Your profile is up to date"}</span><button className="button" disabled={saving || !hasUnsavedChanges} aria-busy={saving}>{saving ? "Saving…" : hasUnsavedChanges ? "Save profile changes" : "No changes to save"} <span aria-hidden="true">→</span></button></div>
                    </form>
                </div>
                <aside className="profile-editor-aside">
                    <span className="profile-aside-icon">✳</span>
                    <p className="profile-edit-kicker"><span /> PROFILE SIGNAL</p>
                    <h3>Be ready to be discovered.</h3>
                    <p>A clear profile helps athletes, scouts, and organizations make the right connection.</p>
                    <div className="profile-aside-divider" />
                    <div className="profile-aside-tip"><span>01</span><p><strong>Keep it current</strong><small>Update your details as your journey moves forward.</small></p></div>
                    <div className="profile-aside-tip"><span>02</span><p><strong>Make it yours</strong><small>Add the information that best represents your goals.</small></p></div>
                    <Link to={profileType === "athlete" ? `/athletes/${profile.id}` : `/agencies/${profile.id}`} className="profile-aside-preview">PREVIEW NETWORK PROFILE <span aria-hidden="true">↗</span></Link>
                </aside>
            </div>
        </div>
    </section>;
}

export function AgencyDirectoryPage() {
    const [agencies, setAgencies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [country, setCountry] = useState("");
    const [googleSearchError, setGoogleSearchError] = useState("");
    const googleSearchEngineId = import.meta.env.VITE_GOOGLE_CSE_CX;

    useEffect(() => {
        api("/agencies").then(({ agencies: records }) => setAgencies(records))
            .catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!googleSearchEngineId) return undefined;

        const renderSearch = () => {
            const searchElement = window.google?.search?.cse?.element;
            if (searchElement) {
                searchElement.render({ div: "google-search-results", tag: "search" });
            }
        };

        if (window.google?.search?.cse?.element) {
            renderSearch();
            return undefined;
        }

        window.__gcse = {
            ...window.__gcse,
            parsetags: "explicit",
            callback: renderSearch,
        };

        const existingScript = document.getElementById("google-cse-script");
        if (!existingScript) {
            const script = document.createElement("script");
            script.id = "google-cse-script";
            script.async = true;
            script.src = `https://cse.google.com/cse.js?cx=${encodeURIComponent(googleSearchEngineId)}`;
            script.onerror = () => setGoogleSearchError("Google Programmable Search could not load. Check your internet connection and Search Engine ID.");
            document.head.appendChild(script);
        }
        return undefined;
    }, [googleSearchEngineId]);

    const countries = useMemo(() => [...new Set(agencies.map((agency) => agency.country).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right)), [agencies]);
    const filteredAgencies = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        return agencies.filter((agency) => {
            const matchesSearch = !query || `${agency.agency_name} ${agency.country} ${agency.contact_phone || ""}`
                .toLocaleLowerCase().includes(query);
            return matchesSearch && (!country || agency.country === country);
        });
    }, [agencies, search, country]);

    return <section className="agency-directory-page">
        <header className="agency-directory-hero">
            <div className="agency-directory-hero-copy">
                <p className="agency-directory-kicker"><span /> THE SCOUTING NETWORK</p>
                <h1>Find your next<br /><span>connection.</span></h1>
                <p>Meet the organizations behind new opportunities. Explore the network and reach out when you find the right fit.</p>
                <a className="agency-directory-scroll" href="#agency-network">EXPLORE THE NETWORK <span aria-hidden="true">↓</span></a>
            </div>
            <div className="agency-directory-visual" aria-hidden="true">
                <span className="agency-network-ring agency-network-ring-outer" />
                <span className="agency-network-ring agency-network-ring-middle" />
                <span className="agency-network-ring agency-network-ring-inner" />
                <span className="agency-network-center">S</span>
                <span className="agency-network-node agency-network-node-one" />
                <span className="agency-network-node agency-network-node-two" />
                <span className="agency-network-node agency-network-node-three" />
                <span className="agency-network-label">TALENT / CONNECTED</span>
            </div>
            <div className="agency-directory-count"><strong>{loading ? "—" : agencies.length.toString().padStart(2, "0")}</strong><span>ORGANIZATIONS</span></div>
        </header>

        <ErrorNotice error={error} />
        <section className="worldwide-search-panel" aria-labelledby="worldwide-search-title">
            <div className="worldwide-search-heading">
                <div><p className="agency-directory-kicker"><span /> BEYOND THE SSCS NETWORK</p><h2 id="worldwide-search-title">Search the world.</h2><p>Explore global sports agencies, scouting organizations, and opportunities with Google.</p></div>
                <span className="worldwide-search-badge"><i /> WORLDWIDE WEB</span>
            </div>
            <p className="worldwide-search-hint">Search results are provided by Google. Verify organizations and contact details independently.</p>
            {googleSearchError && <ErrorNotice error={googleSearchError} />}
            {googleSearchEngineId
                ? <div className="google-search-frame">
                    <div className="google-search-frame-heading">
                        <span><i /> WORLDWIDE INDEX</span>
                        <span>POWERED BY GOOGLE</span>
                    </div>
                    <div id="google-search-results" className="google-search-results" aria-label="Google worldwide search" />
                </div>
                : <div className="google-search-setup" role="status">
                    <strong>Connect your search engine</strong>
                    <span>Add <code>VITE_GOOGLE_CSE_CX</code> to <code>sscs_frontend/.env</code>, then restart Vite. You do not need a Google API key for the embedded search.</span>
                </div>}
        </section>

        <section className="agency-network-section" id="agency-network">
            <div className="agency-network-heading">
                <div><p className="agency-directory-kicker"><span /> ORGANIZATIONS ON SSCS</p><h2>Explore the network.</h2></div>
                <p>Browse registered sports organizations and find the right people to connect with.</p>
            </div>

            <div className="agency-directory-tools">
                <label className="agency-directory-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search agencies, countries…" aria-label="Search agencies by name, country, or phone" /></label>
                <label className="agency-country-filter"><span>LOCATION</span><select value={country} onChange={(event) => setCountry(event.target.value)} aria-label="Filter agencies by country"><option value="">All countries</option>{countries.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
                <span className="agency-result-count">{loading ? "Loading…" : `${filteredAgencies.length} ${filteredAgencies.length === 1 ? "organization" : "organizations"}`}</span>
            </div>

            {loading ? <PageLoading /> : filteredAgencies.length > 0
                ? <div className="agency-network-grid">{filteredAgencies.map((agency, index) =>
                    <article className="agency-network-card" key={agency.id}>
                        <div className="agency-network-card-top">
                            <span className="agency-network-card-index">{String(index + 1).padStart(2, "0")} / SSCS PARTNER</span>
                            <span className="agency-country-chip"><i />{agency.country || "Location not listed"}</span>
                        </div>
                        <PhotoAvatar userId={agency.user_id} initials={(agency.agency_name?.[0] || "A").toUpperCase()} hasPhoto={agency.has_profile_photo} className="agency-network-emblem" alt={`${agency.agency_name} profile photo`} />
                        <h3>{agency.agency_name}<VerifiedAccountTick status={agency.verification_status} /></h3>
                        <p className="agency-network-card-meta">{agency.contact_phone ? <><span className="agency-contact-pulse" />{agency.contact_phone}</> : <><span className="agency-contact-pulse" />Available through SSCS</>}</p>
                        <div className="agency-network-card-footer">
                            <span>SPORTS ORGANIZATION</span>
                            <Link to={`/agencies/${agency.id}`} aria-label={`View ${agency.agency_name}`}>View profile <span aria-hidden="true">↗</span></Link>
                        </div>
                        <span className="agency-card-index-watermark" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    </article>
                )}</div>
                : <div className="agency-directory-empty">
                    <span aria-hidden="true">⌕</span>
                    <p className="agency-directory-kicker"><span /> NO MATCHES FOUND</p>
                    <h3>{agencies.length ? "No agencies match those filters." : "The network is just getting started."}</h3>
                    <p>{agencies.length ? "Try another search or choose a different location." : "Registered sports organizations will appear here as they join SSCS."}</p>
                    {(search || country) && <button type="button" onClick={() => { setSearch(""); setCountry(""); }}>Clear filters</button>}
                </div>}
        </section>
    </section>;
}

export function AgencyDetailPage() {
    const { id } = useParams();
    const { user } = useAuth();
    const [agency, setAgency] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api(`/agencies/${id}`).then(({ agency: record }) => setAgency(record))
            .catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
    }, [id]);

    if (loading) return <PageLoading />;
    if (error) return <ErrorNotice error={error} />;
    if (!agency) return null;
    return <>
        <Link className="back-link" to="/agencies">← Back to agencies</Link>
        <section className="agency-detail agency-profile">
            <header className="agency-profile-header">
                <PhotoAvatar userId={agency.user_id} initials={agency.agency_name[0]} hasPhoto={agency.has_profile_photo} className="agency-emblem agency-emblem-large" alt={`${agency.agency_name} profile photo`} />
                <div className="agency-profile-identity">
                    <p className="eyebrow">SPORTS ORGANIZATION</p>
                    <h1>{agency.agency_name}<VerifiedAccountTick status={agency.verification_status} /></h1>
                    <span className="badge badge-green">{agency.country || "Country not listed"}</span>
                </div>
            </header>
            <div className="agency-profile-body">
                <section className="agency-profile-contact" aria-labelledby="agency-contact-heading">
                    <p className="eyebrow" id="agency-contact-heading">CONTACT INFORMATION</p>
                    {agency.contact_phone && <p className="agency-contact"><strong>Phone</strong><span>{agency.contact_phone}</span></p>}
                    {agency.contact_details && <p className="prewrap agency-contact">{agency.contact_details}</p>}
                    {!agency.contact_phone && !agency.contact_details && <p className="agency-profile-empty">This organization has not shared contact details yet.</p>}
                </section>
                {agency.user_id !== user?.id && <Link className="button" to={`/messages/new/${agency.user_id}`}>Send a message <span aria-hidden="true">↗</span></Link>}
            </div>
        </section>
    </>;
}

export function ShortlistPage() {
    const [shortlist, setShortlist] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(() => api("/shortlist")
        .then(({ shortlist: rows }) => setShortlist(rows))
        .catch((requestError) => setError(requestError.message))
        .finally(() => setLoading(false)), []);

    useEffect(() => { load(); }, [load]);

    async function remove(athlete) {
        try {
            await api(`/shortlist/${athlete.id}`, { method: "DELETE" });
            setShortlist((current) => current.filter((entry) => entry.id !== athlete.id));
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    return <>
        <PageIntro eyebrow="YOUR SAVED TALENT" title="My shortlist" description="A private collection of athletes saved by your agency." action={<Link className="button button-outline" to="/athletes">Find more athletes</Link>} />
        <ErrorNotice error={error} />
        {loading ? <PageLoading /> : <div className="athlete-grid">
            {shortlist.map((athlete) => <article className="athlete-card" key={athlete.id}>
                <div className="athlete-card-head"><PhotoAvatar userId={athlete.user_id} initials={`${athlete.first_name[0]}${athlete.last_name[0]}`} hasPhoto={athlete.has_profile_photo} className="avatar" /><span className="badge badge-green">{athlete.sport}</span></div>
                <h3>{athlete.first_name} {athlete.last_name}<VerifiedAccountTick status={athlete.verification_status} /></h3>
                <p className="card-subtitle">{athlete.position} · {athlete.location}</p>
                <div className="card-actions">
                    <Link className="button button-outline button-compact" to={`/athletes/${athlete.id}`}>View profile</Link>
                    <Link className="button button-compact" to={`/messages/new/${athlete.user_id}`}>Message</Link>
                    <button className="button button-quiet button-compact" onClick={() => remove(athlete)}>Remove</button>
                </div>
            </article>)}
            {shortlist.length === 0 && <EmptyState title="Your shortlist is ready" action={<Link className="button" to="/athletes">Find athletes</Link>}>Save profiles that match your agency’s search and they’ll appear here.</EmptyState>}
        </div>}
    </>;
}

export function InboxPage() {
    const [messages, setMessages] = useState([]);
    const [blocks, setBlocks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [reportNotice, setReportNotice] = useState("");
    const [reportTarget, setReportTarget] = useState(null);
    const [reportCategory, setReportCategory] = useState("harassment");
    const [reportDetails, setReportDetails] = useState("");
    const [reportSubmitting, setReportSubmitting] = useState(false);
    const [tab, setTab] = useState("received");
    const [search, setSearch] = useState("");
    const { user } = useAuth();

    const loadMessages = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [messageResult, blockResult] = await Promise.all([
                api("/messages"),
                api("/blocks"),
            ]);
            setMessages(messageResult.messages);
            setBlocks(blockResult.blocks);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadMessages();
    }, [loadMessages]);

    const receivedMessages = messages.filter((message) => String(message.recipient_id) === String(user.id));
    const sentMessages = messages.filter((message) => String(message.sender_id) === String(user.id));
    const unreadCount = receivedMessages.filter((message) => !message.is_read).length;

    const filteredMessages = useMemo(() => messages.filter((message) => (
        tab === "received" ? String(message.recipient_id) === String(user.id) : String(message.sender_id) === String(user.id)
    )).filter((message) => {
        const otherPerson = tab === "received" ? message.sender_username : message.recipient_username;
        const query = search.trim().toLocaleLowerCase();
        return !query || `${otherPerson} ${message.body}`.toLocaleLowerCase().includes(query);
    }), [messages, tab, user.id, search]);

    async function markRead(message) {
        if (message.is_read || String(message.recipient_id) !== String(user.id)) return;
        try {
            const result = await api(`/messages/${message.id}/read`, { method: "PATCH", body: {} });
            setMessages((current) => current.map((item) => item.id === message.id ? { ...item, is_read: result.message.is_read } : item));
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    async function toggleBlock(blockedUserId) {
        setError("");
        const isBlocked = blocks.some((block) => String(block.blocked_user_id) === String(blockedUserId));
        try {
            if (isBlocked) {
                await api(`/blocks/${blockedUserId}`, { method: "DELETE" });
                setBlocks((current) => current.filter((block) => String(block.blocked_user_id) !== String(blockedUserId)));
            } else {
                await api("/blocks", { method: "POST", body: { blockedUserId } });
                setBlocks((current) => [...current, { blocked_user_id: blockedUserId }]);
            }
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    function openReport(targetUserId, username, messageId = null) {
        setReportNotice("");
        setError("");
        setReportTarget({ userId: targetUserId, username, messageId });
        setReportCategory("harassment");
        setReportDetails("");
    }

    async function submitReport(event) {
        event.preventDefault();
        if (!reportTarget) return;
        setReportSubmitting(true);
        setError("");
        try {
            await api("/reports", {
                method: "POST",
                body: {
                    targetUserId: reportTarget.userId,
                    ...(reportTarget.messageId ? { messageId: reportTarget.messageId } : {}),
                    category: reportCategory,
                    details: reportDetails,
                },
            });
            setReportTarget(null);
            setReportDetails("");
            setReportNotice("Report submitted. An administrator will review it.");
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setReportSubmitting(false);
        }
    }

    return <section className="inbox-page">
        <header className="inbox-hero">
            <div className="inbox-hero-copy">
                <p className="inbox-kicker"><span /> SSCS COMMUNICATIONS</p>
                <h1>Your inbox,<br /><span>in the game.</span></h1>
                <p>Every connection starts with a conversation. Catch up with your network and keep opportunity moving.</p>
            </div>
            <div className="inbox-hero-visual" aria-hidden="true">
                <span className="inbox-visual-orbit inbox-visual-orbit-one" />
                <span className="inbox-visual-orbit inbox-visual-orbit-two" />
                <span className="inbox-visual-core">⌁</span>
                <span className="inbox-signal inbox-signal-one" />
                <span className="inbox-signal inbox-signal-two" />
                <span className="inbox-visual-label">NETWORK / ONLINE</span>
            </div>
            <div className="inbox-hero-count"><strong>{unreadCount.toString().padStart(2, "0")}</strong><span>UNREAD</span></div>
        </header>

        <div className="inbox-overview">
            <div className="inbox-overview-item"><span className="inbox-overview-icon">↙</span><span><small>RECEIVED</small><strong>{receivedMessages.length.toString().padStart(2, "0")}</strong></span></div>
            <div className="inbox-overview-item"><span className="inbox-overview-icon">↗</span><span><small>SENT</small><strong>{sentMessages.length.toString().padStart(2, "0")}</strong></span></div>
            <div className="inbox-overview-note"><span className="inbox-live-indicator" /> YOUR NETWORK IS READY WHEN YOU ARE</div>
        </div>

        <ErrorNotice error={error} />
        <SuccessNotice>{reportNotice}</SuccessNotice>
        {reportTarget && <form className="report-compose" onSubmit={submitReport}>
            <div className="report-compose-heading">
                <div><p className="inbox-kicker"><span /> SAFETY REPORT</p><h2>Report {reportTarget.messageId ? "message" : "account"}</h2></div>
                <button className="inbox-mark-read" type="button" onClick={() => setReportTarget(null)}>Cancel</button>
            </div>
            <p>Reporting <strong>{reportTarget.username}</strong>. Reports are reviewed by an administrator; this does not automatically suspend the account.</p>
            <div className="report-compose-fields">
                <label className="form-field">
                    <span>Reason</span>
                    <select value={reportCategory} onChange={(event) => setReportCategory(event.target.value)} required>
                        <option value="harassment">Harassment or bullying</option>
                        <option value="spam">Spam or scam</option>
                        <option value="inappropriate">Inappropriate content</option>
                        <option value="impersonation">Impersonation</option>
                        <option value="other">Other</option>
                    </select>
                </label>
                <label className="form-field">
                    <span>Additional details (optional)</span>
                    <textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} maxLength={1000} rows={3} />
                </label>
            </div>
            <div className="report-compose-footer"><small>{reportDetails.length}/1000 characters</small><button className="button button-compact" disabled={reportSubmitting}>{reportSubmitting ? "Submitting…" : "Submit report"}</button></div>
        </form>}
        <section className="inbox-board" aria-label="Messages">
            <div className="inbox-board-heading">
                <div><p className="inbox-kicker"><span /> MESSAGE CENTER</p><h2>Conversations</h2></div>
                <button className="inbox-refresh" type="button" onClick={loadMessages} disabled={loading}><span aria-hidden="true">↻</span> {loading ? "Updating" : "Refresh"}</button>
            </div>
            <div className="inbox-controls">
                <div className="inbox-tabs" role="tablist" aria-label="Message folder">
                    <button role="tab" aria-selected={tab === "received"} className={tab === "received" ? "tab active" : "tab"} onClick={() => setTab("received")}>Received <span>{receivedMessages.length}</span></button>
                    <button role="tab" aria-selected={tab === "sent"} className={tab === "sent" ? "tab active" : "tab"} onClick={() => setTab("sent")}>Sent <span>{sentMessages.length}</span></button>
                </div>
                <label className="inbox-search">
                    <span aria-hidden="true">⌕</span>
                    <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people or messages" aria-label="Search people or message text" />
                    <kbd>/</kbd>
                </label>
            </div>
            {loading ? <PageLoading /> : <div className="message-list">
            {filteredMessages.map((message) => {
                const incoming = String(message.recipient_id) === String(user.id);
                const otherId = incoming ? message.sender_id : message.recipient_id;
                const otherUsername = incoming ? message.sender_username : message.recipient_username;
                const isBlocked = blocks.some((block) => String(block.blocked_user_id) === String(otherId));
                return <article className={`message-card inbox-message-card ${incoming && !message.is_read ? "message-unread" : ""}`} key={message.id} onMouseEnter={() => markRead(message)} onFocus={() => markRead(message)}>
                    <div className="message-card-top">
                        <PhotoAvatar userId={otherId} initials={(otherUsername?.[0] || "?").toUpperCase()} hasPhoto={incoming ? message.sender_has_profile_photo : message.recipient_has_profile_photo} className="message-avatar" />
                        <div className="message-heading"><span className="message-heading-person"><strong>{otherUsername}</strong><small>{incoming ? "SENT YOU A MESSAGE" : "MESSAGE SENT TO"}</small></span><time>{formatDate(message.sent_at)}</time></div>
                        {incoming && !message.is_read && <span className="inbox-unread-tag"><i /> NEW</span>}
                    </div>
                    <p className="message-body">{message.body}</p>
                    <div className="inbox-message-footer">
                        <span className="inbox-message-status"><i /> {isBlocked ? "NEW MESSAGES BLOCKED" : incoming ? (message.is_read ? "READ" : "AWAITING YOUR REPLY") : "SENT"}</span>
                        <div className="inbox-message-actions">
                            {!message.is_read && <button className="inbox-mark-read" type="button" onClick={() => markRead(message)}>Mark read</button>}
                            {incoming && !isBlocked && <Link className="inbox-reply" to={`/messages/new/${otherId}`}>Reply <span aria-hidden="true">↗</span></Link>}
                            <button className="inbox-safety-action" type="button" onClick={() => toggleBlock(otherId)}>{isBlocked ? "Unblock" : "Block"}</button>
                            <button className="inbox-safety-action" type="button" onClick={() => openReport(otherId, otherUsername)}>Report account</button>
                            <button className="inbox-safety-action" type="button" onClick={() => openReport(otherId, otherUsername, message.id)}>Report message</button>
                        </div>
                    </div>
                </article>;
            })}
            {filteredMessages.length === 0 && <div className="inbox-empty-state">
                <span className="inbox-empty-icon" aria-hidden="true">⌁</span>
                <p className="inbox-kicker"><span /> NO SIGNALS YET</p>
                <h3>{search ? "No matching messages" : tab === "received" ? "Your inbox is clear." : "Nothing sent yet."}</h3>
                <p>{search ? "Try another name or keyword to find a conversation." : "When conversations begin across your network, you’ll find them here."}</p>
                {search && <button type="button" className="inbox-clear-search" onClick={() => setSearch("")}>Clear search</button>}
            </div>}
            </div>}
        </section>
    </section>;
}

export function NewMessagePage() {
    const { recipientId } = useParams();
    const navigate = useNavigate();
    const [recipient, setRecipient] = useState(null);
    const [body, setBody] = useState("");
    const [error, setError] = useState("");
    const [sending, setSending] = useState(false);

    useEffect(() => {
        api(`/recipients/${recipientId}`).then(({ recipient: record }) => setRecipient(record))
            .catch((requestError) => setError(requestError.message));
    }, [recipientId]);

    async function submit(event) {
        event.preventDefault();
        setError("");
        setSending(true);
        try {
            await api("/messages", { method: "POST", body: { recipientId, body } });
            navigate("/inbox");
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSending(false);
        }
    }

    return <section className="form-page">
        <Link className="back-link" to="/inbox">← Back to inbox</Link>
        <div className="form-card message-compose">
            <p className="eyebrow">START A CONVERSATION</p><h1>Send a message</h1>
            {recipient ? <p className="compose-recipient">To <strong>{recipient.display_name}</strong> <span className="badge">{recipient.role}</span></p> : <Loading label="Finding recipient…" />}
            <ErrorNotice error={error} />
            <form onSubmit={submit}>
                <TextArea label="Your message" name="body" value={body} onChange={(event) => setBody(event.target.value)} rows={8} required maxLength={5000} placeholder="Introduce yourself and explain what you would like to discuss…" />
                <div className="form-footer"><small>{body.length}/5000 characters</small><button className="button" disabled={!recipient || sending}>{sending ? "Sending…" : "Send message"}</button></div>
            </form>
        </div>
    </section>;
}

export function AdminDashboardPage() {
    const { user } = useAuth();
    const [summary, setSummary] = useState(null);
    const [users, setUsers] = useState([]);
    const [reports, setReports] = useState([]);
    const [passwordResetRequests, setPasswordResetRequests] = useState([]);
    const [passwordResetAudit, setPasswordResetAudit] = useState([]);
    const [issuedResetCodes, setIssuedResetCodes] = useState({});
    const [reviewingAccounts, setReviewingAccounts] = useState(() => new Set());
    const [reviewingPasswordResetRequests, setReviewingPasswordResetRequests] = useState(() => new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadDashboard = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [counts, accounts, reportQueue, passwordResetQueue, resetAudit] = await Promise.all([
                api("/admin/summary"),
                api("/admin/users"),
                api("/admin/reports"),
                api("/admin/password-reset-requests"),
                api("/admin/password-reset-audit"),
            ]);
            if (!counts?.summary || !Array.isArray(accounts?.users) || !Array.isArray(reportQueue?.reports)
                || !Array.isArray(passwordResetQueue?.requests) || !Array.isArray(resetAudit?.events)) {
                throw new Error("The server returned incomplete administrator dashboard data.");
            }
            setSummary(counts.summary);
            setUsers(accounts.users);
            setReports(reportQueue.reports);
            setPasswordResetRequests(passwordResetQueue.requests);
            setPasswordResetAudit(resetAudit.events);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadDashboard();
    }, [loadDashboard]);

    async function changeActive(user) {
        try {
            const result = await api(`/admin/users/${user.id}/active`, { method: "PATCH", body: { isActive: !user.is_active } });
            setUsers((current) => current.map((account) => account.id === user.id
                ? { ...account, ...result.user }
                : account));
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    async function changeVerification(account, status) {
        setError("");
        const accountId = String(account.id);
        setReviewingAccounts((current) => new Set(current).add(accountId));
        try {
            const { verification } = await api(`/admin/users/${account.id}/verification`, {
                method: "PATCH",
                body: { status },
            });
            setUsers((current) => current.map((entry) => entry.id === account.id
                ? { ...entry, ...verification }
                : entry));
            if (account.verification_status === "pending" && ["verified", "rejected"].includes(status)) {
                setSummary((current) => current ? {
                    ...current,
                    pending_approval_requests: Math.max(0, current.pending_approval_requests - 1),
                } : current);
                window.dispatchEvent(new Event("sscs:refresh-admin-alerts"));
            }
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setReviewingAccounts((current) => {
                const next = new Set(current);
                next.delete(accountId);
                return next;
            });
        }
    }

    async function reviewReport(report, status) {
        setError("");
        try {
            const { report: reviewedReport } = await api(`/admin/reports/${report.id}`, {
                method: "PATCH",
                body: { status },
            });
            setReports((current) => current.map((entry) => entry.id === report.id
                ? { ...entry, ...reviewedReport, reviewer_username: user.username }
                : entry));
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    async function reviewPasswordResetRequest(resetRequest, status) {
        setError("");
        const requestId = String(resetRequest.id);
        setReviewingPasswordResetRequests((current) => new Set(current).add(requestId));
        try {
            const result = await api(`/admin/password-reset-requests/${resetRequest.id}`, {
                method: "PATCH",
                body: { status },
            });
            if (status === "declined") {
                setPasswordResetRequests((current) => current.filter((entry) => entry.id !== resetRequest.id));
                setIssuedResetCodes((current) => {
                    const next = { ...current };
                    delete next[resetRequest.id];
                    return next;
                });
            } else {
                setPasswordResetRequests((current) => current.map((entry) => entry.id === resetRequest.id
                    ? { ...entry, ...result.request }
                    : entry));
                setIssuedResetCodes((current) => ({ ...current, [resetRequest.id]: result.resetCode }));
            }
            if (resetRequest.status === "pending" && ["approved", "declined"].includes(status)) {
                setSummary((current) => current ? {
                    ...current,
                    pending_password_reset_requests: Math.max(0, current.pending_password_reset_requests - 1),
                } : current);
            }
            window.dispatchEvent(new Event("sscs:refresh-admin-alerts"));
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setReviewingPasswordResetRequests((current) => {
                const next = new Set(current);
                next.delete(requestId);
                return next;
            });
        }
    }

    return <div className="admin-dashboard-page">
        <section className="admin-command-header">
            <div className="admin-command-copy">
                <p className="admin-kicker"><span /> SSCS ADMINISTRATION</p>
                <h1>Administrator dashboard</h1>
                <p>Manage user accounts, review verification requests, and monitor platform activity.</p>
            </div>
            <div className="admin-command-panel">
                <span className={`admin-system-status${error ? " is-warning" : ""}`}><i />{error ? "ATTENTION REQUIRED" : "ADMINISTRATOR ACCESS"}</span>
                <span className="admin-panel-divider" />
                <span className="admin-session-label">SIGNED IN AS</span>
                <strong>{user?.username || "SSCS ADMINISTRATOR"}</strong>
                <button className="admin-refresh-button" onClick={() => void loadDashboard()} disabled={loading}>
                    <span aria-hidden="true">{loading ? "◌" : "↻"}</span>
                    {loading ? "Refreshing data" : "Refresh dashboard"}
                </button>
            </div>
            <div className="admin-header-grid" aria-hidden="true" />
        </section>

        <ErrorNotice error={error} />
        {loading && <PageLoading label="Synchronizing platform data…" />}
        {summary?.pending_approval_requests > 0 && <section className="admin-approval-alert" aria-label="Pending account approvals" aria-live="polite">
            <div className="admin-approval-alert-icon" aria-hidden="true">!</div>
            <div className="admin-approval-alert-copy">
                <p className="admin-approval-alert-kicker">ACTION REQUIRED · ACCOUNT VERIFICATION</p>
                <h2>{summary.pending_approval_requests} account{summary.pending_approval_requests === 1 ? "" : "s"} awaiting approval</h2>
                <p>These athletes and agencies have requested administrator review. Check each account before approving or rejecting.</p>
            </div>
            <a className="admin-approval-alert-link" href="#approval-queue">Review approval queue <span aria-hidden="true">↓</span></a>
            {users.some((account) => account.verification_status === "pending") && <ul className="admin-approval-preview">
                {users.filter((account) => account.verification_status === "pending").slice(0, 3).map((account) => <li key={account.id}>
                    <span className="admin-approval-account">
                        <strong>{account.username}</strong>
                        <small>{account.role === "scout" ? "Scout / Agency" : account.role}{account.verification_requested_at ? ` · Requested ${formatDate(account.verification_requested_at)}` : ""}</small>
                    </span>
                    <span className="admin-approval-actions">
                        <button className="admin-approval-review-button" onClick={() => changeVerification(account, "verified")} disabled={reviewingAccounts.has(String(account.id))}>
                            {reviewingAccounts.has(String(account.id)) ? "Reviewing…" : "Approve"}
                        </button>
                        <button className="admin-approval-reject-button" onClick={() => changeVerification(account, "rejected")} disabled={reviewingAccounts.has(String(account.id))}>
                            Reject
                        </button>
                    </span>
                </li>)}
            </ul>}
        </section>}
        {summary?.pending_password_reset_requests > 0 && <section className="admin-reset-alert" aria-label="Password reset requests require review" aria-live="polite">
            <div className="admin-reset-alert-icon" aria-hidden="true">!</div>
            <div>
                <p className="admin-reset-alert-kicker">ACTION REQUIRED · ACCOUNT ACCESS</p>
                <h2>{summary.pending_password_reset_requests} password reset request{summary.pending_password_reset_requests === 1 ? "" : "s"} need review</h2>
                <p>Verify the requester through a trusted channel before approving. Approved codes are shown once and must be shared securely.</p>
            </div>
            <a href="#password-reset-queue">Review reset requests <span aria-hidden="true">↓</span></a>
        </section>}
        <section className="admin-overview-section" aria-label="Platform metrics">
            <div className="admin-section-heading">
                <div><p className="admin-kicker"><span /> LIVE OVERVIEW</p><h2>Platform telemetry</h2></div>
                <span className="admin-updated"><i /> {loading ? "SYNCING" : error ? "SYNC INTERRUPTED" : "LATEST DATA"}</span>
            </div>
            <div className="admin-metrics">
                <MetricCard label="Total users" value={summary?.total_users} icon="◉" tone="lime" />
                <MetricCard label="Athlete accounts" value={summary?.athlete_accounts} icon="↗" tone="violet" />
                <MetricCard label="Agencies" value={summary?.agencies} icon="⌂" tone="cyan" />
                <MetricCard label="Shortlist entries" value={summary?.shortlist_entries} icon="✳" tone="amber" />
                <MetricCard label="Messages" value={summary?.messages} icon="⌁" tone="rose" />
            </div>
        </section>
        <AdminSupportInbox />

        <section className="admin-users admin-directory" id="approval-queue">
            <div className="admin-directory-heading">
                <div><p className="admin-kicker"><span /> ACCOUNT OVERSIGHT</p><h2>Registered users</h2><p>Review account access and open each record to inspect its saved profile fields.</p></div>
                <div className="admin-record-count"><strong>{users.length.toString().padStart(2, "0")}</strong><span>RECORDS<br />LOADED</span></div>
            </div>
            <div className="table-scroll"><table><thead><tr><th>Account</th><th>Email address</th><th>Role</th><th>Joined</th><th>Access</th><th>Verification</th><th>Review</th><th>Manage</th><th>Profile data</th></tr></thead>
                <tbody>{users.map((account) => <tr key={account.id}>
                    <td><strong className="admin-username"><span>{account.username.slice(0, 1).toUpperCase()}</span>{account.username}<VerifiedAccountTick status={account.verification_status} role={account.role} /></strong></td>
                    <td>{account.email}</td>
                    <td><span className={`admin-role-badge admin-role-${account.role}`}>{account.role === "scout" ? "Scout / Agency" : account.role}</span></td>
                    <td>{formatDate(account.created_at)}</td>
                    <td><span className={`admin-access-status${account.is_active ? " is-active" : ""}`}><i />{account.is_active ? "Active" : "Inactive"}</span></td>
                    <td>
                        <span className={`admin-verification-status is-${account.verification_status || "unverified"}`}>
                            {account.role === "admin" ? "Verification not required" : (account.verification_status || "unverified")}
                        </span>
                        {account.verification_reviewed_at && <small className="admin-review-date">{formatDate(account.verification_reviewed_at)}</small>}
                    </td>
                    <td>{account.role !== "admin" && account.verification_status === "pending" ? <>
                        <button className="admin-manage-button admin-review-approve" onClick={() => changeVerification(account, "verified")}>Approve</button>
                        <button className="admin-manage-button admin-review-reject" onClick={() => changeVerification(account, "rejected")}>Reject</button>
                    </> : account.role !== "admin" && account.verification_status === "verified" ?
                        <button className="admin-manage-button" onClick={() => changeVerification(account, "unverified")}>Revoke review</button> :
                        <span className="admin-review-waiting">No request</span>}</td>
                    <td>{account.role !== "admin" && <button className="admin-manage-button" onClick={() => changeActive(account)}>{account.is_active ? "Suspend access" : "Restore access"}</button>}</td>
                    <td><AdminAccountDetails account={account} /></td>
                </tr>)}</tbody>
            </table></div>
            {!loading && !error && users.length === 0 && <div className="admin-empty-state"><span>◎</span><strong>No accounts in the network yet</strong><p>Registered athlete and agency accounts will appear here.</p></div>}
        </section>
        <section className="admin-users admin-directory admin-password-reset-queue" id="password-reset-queue">
            <div className="admin-directory-heading">
                <div><p className="admin-kicker"><span /> ACCOUNT ACCESS</p><h2>Password reset requests</h2><p>Confirm the requester’s identity outside SSCS before approval. A generated code expires in 30 minutes and can be used once.</p></div>
                <div className="admin-record-count"><strong>{passwordResetRequests.filter((entry) => entry.status === "pending").length.toString().padStart(2, "0")}</strong><span>PENDING<br />REQUESTS</span></div>
            </div>
            {passwordResetRequests.length > 0 ? <div className="admin-report-list">{passwordResetRequests.map((resetRequest) => {
                const requestId = String(resetRequest.id);
                const isReviewing = reviewingPasswordResetRequests.has(requestId);
                const code = issuedResetCodes[resetRequest.id];
                return <article className="admin-report-card password-reset-request-card" key={requestId}>
                    <div className="admin-report-card-heading">
                        <div>
                            <span className={`admin-report-status is-${resetRequest.status}`}>{resetRequest.status}</span>
                            <h3>{resetRequest.username} · {resetRequest.email}</h3>
                        </div>
                        <time>{formatDate(resetRequest.requested_at)}</time>
                    </div>
                    <p className="admin-report-meta">{resetRequest.role === "scout" ? "Scout / Agency" : resetRequest.role} account</p>
                    {resetRequest.failed_attempts > 0 && <p className="password-reset-attempt-count">
                        Incorrect code attempts: {resetRequest.failed_attempts} of 5{resetRequest.failed_attempts >= 5 ? " · code locked" : ""}
                    </p>}
                    {resetRequest.status === "pending" ? <div className="admin-report-actions">
                        <button className="admin-manage-button admin-review-approve" onClick={() => reviewPasswordResetRequest(resetRequest, "approved")} disabled={isReviewing}>
                            {isReviewing ? "Reviewing…" : "Approve & generate code"}
                        </button>
                        <button className="admin-manage-button admin-review-reject" onClick={() => reviewPasswordResetRequest(resetRequest, "declined")} disabled={isReviewing}>
                            Decline request
                        </button>
                    </div> : <div className="password-reset-approved-actions">
                        <p>{resetRequest.reset_code_expires_at
                            ? `Code expires ${formatDate(resetRequest.reset_code_expires_at)}.`
                            : "The prior code is expired; issue a replacement if the user still needs access."}</p>
                        <button className="admin-manage-button" onClick={() => reviewPasswordResetRequest(resetRequest, "regenerate")} disabled={isReviewing}>
                            {isReviewing ? "Generating…" : "Generate replacement code"}
                        </button>
                    </div>}
                    {code && <div className="password-reset-code-panel" role="status">
                        <strong>One-time code — share through a trusted channel</strong>
                        <input aria-label={`Reset code for ${resetRequest.username}`} readOnly value={code} onFocus={(event) => event.target.select()} />
                        <p>This code is displayed only in this admin session. Regenerating it immediately invalidates the previous code.</p>
                    </div>}
                </article>;
            })}</div> : !loading && <div className="admin-empty-state"><span>◎</span><strong>No active password reset requests</strong><p>New requests from the sign-in page will appear here.</p></div>}
        </section>
        <section className="admin-users admin-directory admin-password-reset-audit">
            <div className="admin-directory-heading">
                <div><p className="admin-kicker"><span /> SECURITY HISTORY</p><h2>Password reset audit trail</h2><p>Recent reset requests, administrator decisions, failed code attempts, and completed password changes.</p></div>
                <div className="admin-record-count"><strong>{passwordResetAudit.length.toString().padStart(2, "0")}</strong><span>RECENT<br />EVENTS</span></div>
            </div>
            {passwordResetAudit.length > 0 ? <div className="password-reset-audit-list">
                {passwordResetAudit.map((event) => <article className="password-reset-audit-event" key={event.id}>
                    <span className={`password-reset-audit-indicator is-${event.event_type}`} aria-hidden="true" />
                    <div>
                        <strong>{event.target_username || "Deleted account"} · {event.target_email || "Account unavailable"}</strong>
                        <p>{passwordResetAuditLabel(event.event_type, event.details)}</p>
                        {event.actor_username && <small>Admin: {event.actor_username}</small>}
                    </div>
                    <time>{formatDate(event.created_at)}</time>
                </article>)}
            </div> : !loading && <div className="admin-empty-state"><span>◎</span><strong>No password reset activity yet</strong><p>Requests and review actions will be recorded here.</p></div>}
        </section>
        <section className="admin-users admin-directory admin-report-queue">
            <div className="admin-directory-heading">
                <div><p className="admin-kicker"><span /> COMMUNITY SAFETY</p><h2>Account &amp; message reports</h2><p>Review reports submitted by users. Reports do not automatically suspend accounts.</p></div>
                <div className="admin-record-count"><strong>{reports.filter((report) => report.status === "pending").length.toString().padStart(2, "0")}</strong><span>PENDING<br />REPORTS</span></div>
            </div>
            {reports.length > 0 ? <div className="admin-report-list">{reports.map((report) => <article className="admin-report-card" key={report.id}>
                <div className="admin-report-card-heading">
                    <div><span className={`admin-report-status is-${report.status}`}>{report.status}</span><h3>{report.message_id ? "Reported message" : "Reported account"}: {report.target_username}</h3></div>
                    <time>{formatDate(report.created_at)}</time>
                </div>
                <p className="admin-report-meta">Submitted by <strong>{report.reporter_username}</strong> · {report.category}</p>
                {report.message_body && <blockquote>{report.message_body}</blockquote>}
                {report.details && <p className="admin-report-details">{report.details}</p>}
                {report.status === "pending"
                    ? <div className="admin-report-actions">
                        <button className="admin-manage-button admin-review-approve" onClick={() => reviewReport(report, "resolved")}>Mark resolved</button>
                        <button className="admin-manage-button admin-review-reject" onClick={() => reviewReport(report, "dismissed")}>Dismiss</button>
                    </div>
                    : <p className="admin-report-reviewed">Reviewed{report.reviewer_username ? ` by ${report.reviewer_username}` : ""}{report.reviewed_at ? ` · ${formatDate(report.reviewed_at)}` : ""}</p>}
            </article>)}</div> : !loading && <div className="admin-empty-state"><span>◎</span><strong>No reports to review</strong><p>New user reports will appear here.</p></div>}
        </section>
    </div>;
}

function passwordResetAuditLabel(eventType, details = {}) {
    const labels = {
        requested: "Password reset requested",
        approved: "Request approved and one-time code issued",
        declined: "Request declined",
        code_regenerated: "One-time code regenerated",
        code_attempt_failed: `Incorrect code attempt ${details.failedAttempts ?? ""} of 5`.trim(),
        code_locked: "Code locked after five incorrect attempts",
        reset_completed: "Password changed successfully",
    };
    return labels[eventType] || "Password reset activity";
}

function AdminAccountDetails({ account }) {
    const profileFields = account.role === "athlete"
        ? [
            ["First name", account.first_name],
            ["Last name", account.last_name],
            ["Sport", account.sport],
            ["Position / event", account.position],
            ["Age", account.age],
            ["Location", account.location],
            ["Bio", account.bio],
            ["Video link", account.video_link],
            ["Career history", account.career_history],
            ["Performance stats", account.performance_stats],
        ]
        : account.role === "scout"
            ? [
                ["Agency name", account.agency_name],
                ["Country", account.country],
                ["Contact phone", account.contact_phone],
                ["Contact details", account.contact_details],
            ]
            : [];
    const hasProfileFields = profileFields.some(([, value]) => value !== null && value !== undefined && value !== "");

    return <details className="admin-account-details">
        <summary>View all fields</summary>
        <dl>
            <dt>Username</dt><dd>{account.username}</dd>
            <dt>Email</dt><dd>{account.email}</dd>
            <dt>Role</dt><dd>{account.role === "scout" ? "Scout / Agency" : account.role}</dd>
            <dt>Account status</dt><dd>{account.is_active ? "Active" : "Inactive"}</dd>
            <dt>Verification</dt><dd>{account.role === "admin" ? "Verification not required" : (account.verification_status || "unverified")}</dd>
            {account.verification_requested_at && <><dt>Review requested</dt><dd>{formatDate(account.verification_requested_at)}</dd></>}
            {account.verification_reviewed_at && <><dt>Last reviewed</dt><dd>{formatDate(account.verification_reviewed_at)}</dd></>}
            {account.verification_reviewed_by && <><dt>Reviewed by admin ID</dt><dd>{account.verification_reviewed_by}</dd></>}
            <dt>Created</dt><dd>{formatDate(account.created_at)}</dd>
            {hasProfileFields ? profileFields.map(([label, value]) => value !== null && value !== undefined && value !== "" && <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}</dd>
            </Fragment>) : <dd>No additional profile fields.</dd>}
        </dl>
    </details>;
}

function MetricCard({ label, value, icon, tone }) {
    return <article className={`admin-metric admin-metric-${tone}`}>
        <div className="admin-metric-top"><span className="admin-metric-icon">{icon}</span><span className="admin-metric-index">SSCS / 0{["Total users", "Athlete accounts", "Agencies", "Shortlist entries", "Messages"].indexOf(label) + 1}</span></div>
        <span className="admin-metric-label">{label}</span>
        <strong className="admin-metric-value">{value ?? "—"}</strong>
        <span className="admin-metric-track"><i /></span>
    </article>;
}
