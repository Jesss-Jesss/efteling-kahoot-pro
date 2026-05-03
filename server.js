const express  = require("express");
const http     = require("http");
const { Server } = require("socket.io");
const path     = require("path");
const session  = require("express-session");
const mongoose = require("mongoose");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = process.env.PORT || 10000;

// ---------------- MONGODB ----------------
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/eftelingquiz";

mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB verbonden"))
    .catch(err => console.error("MongoDB fout:", err));

const vraagSchema = new mongoose.Schema({
    type:       { type: String, enum: ["meerkeuze", "open"], default: "meerkeuze" },
    vraag:      { type: String, required: true },
    antwoorden: [{ tekst: String, correct: Boolean }],
    tijdlimiet: { type: Number, default: 20 },
    punten:     { type: Number, default: 1000 }
});
const quizSchema = new mongoose.Schema({
    naam:       { type: String, required: true },
    vragen:     [vraagSchema],
    aangemaakt: { type: Date, default: Date.now },
    bijgewerkt: { type: Date, default: Date.now }
});
const Quiz = mongoose.model("Quiz", quizSchema);

// ---------------- VARIABLES ----------------
let quizStarted = false;
const DASHBOARD_PASSWORD = "1234";
const SPELLEIDER_PASSWORD = "1234";
const allowedNames = ["Stef"];
let nextJoinId = 1001;
let pendingPlayers = [];

let currentGame = {
    id: null, players: [], scores: {},
    quizId: null, quizData: null,
    huidigeVraag: -1, fase: "lobby",
    antwoorden: {},      // meerkeuze: { name:{antwoordIndex,seconden} }  open: { name:{antwoordTekst,seconden} }
    openGroepen: {},     // { normaalSleutel: { namen, tekst, beslissing:null|"goed"|"fout" } }
    vraagStartTijd: null
};
let pendingApprovals = {};

// ---------------- HELPERS ----------------
function normaliseer(tekst) {
    return (tekst || "").toLowerCase().trim()
        .replace(/\s+/g, " ")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function groepeerOpenAntwoorden() {
    const groepen = {};
    Object.entries(currentGame.antwoorden).forEach(([naam, data]) => {
        if (data.antwoordTekst === undefined) return;
        const sleutel = normaliseer(data.antwoordTekst);
        if (!groepen[sleutel]) groepen[sleutel] = { namen: [], tekst: data.antwoordTekst, sleutel, beslissing: null };
        groepen[sleutel].namen.push(naam);
    });
    return groepen;
}

function berekenPunten(vraag, seconden) {
    const basis = vraag.punten || 1000;
    const tijdlimiet = vraag.tijdlimiet || 20;
    return basis + Math.round((Math.max(0, tijdlimiet - seconden) / tijdlimiet) * basis * 0.1);
}

function isOpenVraag() {
    if (!currentGame.quizData) return false;
    const v = currentGame.quizData.vragen[currentGame.huidigeVraag];
    return v && v.type === "open";
}

function verwerkScores() {
    if (!currentGame.quizData) return;
    const vraag = currentGame.quizData.vragen[currentGame.huidigeVraag];
    if (!vraag) return;
    if (vraag.type === "open") {
        Object.values(currentGame.openGroepen).forEach(groep => {
            if (groep.beslissing !== "goed") return;
            groep.namen.forEach(naam => {
                const data = currentGame.antwoorden[naam];
                if (!data) return;
                currentGame.scores[naam] = (currentGame.scores[naam] || 0) + berekenPunten(vraag, data.seconden || 0);
            });
        });
    } else {
        Object.entries(currentGame.antwoorden).forEach(([name, data]) => {
            const antwoord = vraag.antwoorden[data.antwoordIndex];
            if (antwoord && antwoord.correct) {
                currentGame.scores[name] = (currentGame.scores[name] || 0) + berekenPunten(vraag, data.seconden);
            }
        });
    }
}

function berekenResultaten() {
    if (!currentGame.quizData) return null;
    const vraag = currentGame.quizData.vragen[currentGame.huidigeVraag];
    if (!vraag) return null;
    if (vraag.type === "open") {
        return {
            type: "open", vraag: vraag.vraag,
            groepen: Object.values(currentGame.openGroepen).map(g => ({
                tekst: g.tekst, namen: g.namen, aantal: g.namen.length,
                correct: g.beslissing === "goed",
                procent: currentGame.players.length > 0 ? Math.round(g.namen.length / currentGame.players.length * 100) : 0
            }))
        };
    }
    const tellingen = {};
    vraag.antwoorden.forEach((a, i) => { tellingen[i] = 0; });
    Object.values(currentGame.antwoorden).forEach(data => { tellingen[data.antwoordIndex] = (tellingen[data.antwoordIndex] || 0) + 1; });
    const totaal = Object.values(tellingen).reduce((s, n) => s + n, 0);
    return {
        type: "meerkeuze", vraag: vraag.vraag,
        antwoorden: vraag.antwoorden.map((a, i) => ({
            tekst: a.tekst, correct: a.correct,
            aantal: tellingen[i] || 0,
            procent: totaal > 0 ? Math.round((tellingen[i] || 0) / totaal * 100) : 0
        }))
    };
}

function berekenPodium() {
    return Object.entries(currentGame.scores)
        .map(([name, score]) => ({ name, score, character: currentGame.players.find(p => p.name === name)?.character || null }))
        .sort((a, b) => b.score - a.score);
}

function buildFasePayload(fase) {
    const base = { fase, huidigeVraag: currentGame.huidigeVraag, totaalVragen: currentGame.quizData ? currentGame.quizData.vragen.length : 0 };
    if (fase === "vraag" && currentGame.quizData) {
        const v = currentGame.quizData.vragen[currentGame.huidigeVraag];
        return { ...base, type: v.type || "meerkeuze", vraag: v.vraag, antwoorden: v.antwoorden.map(a => ({ tekst: a.tekst })), tijdlimiet: v.tijdlimiet || 20, punten: v.punten || 1000, vraagStartTijd: currentGame.vraagStartTijd };
    }
    if (fase === "keuring") return { ...base, openGroepen: currentGame.openGroepen, aantalAntwoorden: Object.keys(currentGame.antwoorden).length };
    if (fase === "resultaten") return { ...base, resultaten: berekenResultaten(), scores: currentGame.scores };
    if (fase === "podium" || fase === "eindpodium") return { ...base, podium: berekenPodium(), scores: currentGame.scores };
    return base;
}

// ---------------- MIDDLEWARE ----------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), { index: false, setHeaders: (res, fp) => { if (fp.endsWith(".html")) res.setHeader("Content-Type","text/html"); } }));
app.use((req, res, next) => { if (req.path.endsWith(".html")) return res.redirect(req.path.replace(".html","")); next(); });
app.set("trust proxy", 1);
app.use(session({ secret:"supersecretkey", resave:false, saveUninitialized:false, cookie:{ secure:process.env.NODE_ENV!=="development", sameSite:"lax", maxAge:1000*60*60*4 } }));

// ---------------- ROUTES ----------------
app.get("/", (req,res)=>res.redirect("/host-login"));
app.get("/host-login", (req,res)=>res.sendFile(path.join(__dirname,"public","host-login.html")));
app.post("/host-login", (req,res)=>{ const p=(req.body.password||"").trim(); if(p===DASHBOARD_PASSWORD){req.session.loggedIn=true;return res.redirect("/quiz-select");} return res.redirect("/host-login?error=1"); });
app.get("/start-quiz",(req,res)=>{ if(!req.session.loggedIn)return res.redirect("/host-login"); res.sendFile(path.join(__dirname,"public","start-quiz.html")); });
app.get("/quiz-select",(req,res)=>{ if(!req.session.loggedIn)return res.redirect("/host-login"); res.sendFile(path.join(__dirname,"public","quiz-select.html")); });
app.get("/quiz-editor",(req,res)=>{ if(!req.session.loggedIn)return res.redirect("/host-login"); res.sendFile(path.join(__dirname,"public","quiz-editor.html")); });
app.get("/host",(req,res)=>{ if(!req.session.loggedIn)return res.redirect("/host-login"); res.sendFile(path.join(__dirname,"public","host.html")); });
app.get("/host.html",(req,res)=>{ if(!req.session.loggedIn)return res.redirect("/host-login"); res.sendFile(path.join(__dirname,"public","host.html")); });
app.get("/player",(req,res)=>res.sendFile(path.join(__dirname,"public","player-scan.html")));
app.get("/player/:joinId",(req,res)=>{ if(!quizStarted)return res.send("Quiz nog niet gestart"); const joinId=Number(req.params.joinId); const player=pendingPlayers.find(p=>p.joinId===joinId); if(!player)return res.send("Ongeldige spelercode"); res.send(`<script>localStorage.setItem("playerName","${player.name}");localStorage.setItem("gameId","${currentGame.id}");window.location.href="/join-aanvraag.html";</script>`); });
app.get("/join-indienen",(req,res)=>res.sendFile(path.join(__dirname,"public","join-indienen.html")));
app.get("/leaderboard",(req,res)=>{ if(!quizStarted)return res.sendFile(path.join(__dirname,"public","quiz-not-started.html")); return res.sendFile(path.join(__dirname,"public","leaderboard.html")); });
app.get("/scores-full",(req,res)=>res.json({gameId:currentGame.id,scores:currentGame.scores,players:currentGame.players}));
app.get("/spelleider-status",(req,res)=>res.json({loggedIn:!!req.session.spelleider}));
app.get("/api/game-state",(req,res)=>res.json({ fase:currentGame.fase, huidigeVraag:currentGame.huidigeVraag, quizData:currentGame.quizData, scores:currentGame.scores, players:currentGame.players, vraagStartTijd:currentGame.vraagStartTijd, resultaten:currentGame.fase==="resultaten"?berekenResultaten():null, podium:(currentGame.fase==="podium"||currentGame.fase==="eindpodium")?berekenPodium():null }));

app.get("/api/quizzen", async(req,res)=>{ if(!req.session.loggedIn)return res.status(401).json({error:"Niet ingelogd"}); try{const q=await Quiz.find({},"naam aangemaakt bijgewerkt vragen").sort({bijgewerkt:-1});res.json({quizzen:q});}catch(e){res.status(500).json({error:"Fout"});} });
app.get("/api/quizzen/:id",async(req,res)=>{ if(!req.session.loggedIn)return res.status(401).json({error:"Niet ingelogd"}); try{const q=await Quiz.findById(req.params.id);if(!q)return res.status(404).json({error:"Niet gevonden"});res.json({quiz:q});}catch(e){res.status(500).json({error:"Fout"});} });
app.post("/api/quizzen",async(req,res)=>{ if(!req.session.loggedIn)return res.status(401).json({error:"Niet ingelogd"}); try{const{naam,vragen}=req.body;if(!naam)return res.status(400).json({error:"Naam verplicht"});const q=new Quiz({naam,vragen:vragen||[]});await q.save();res.json({success:true,quiz:q});}catch(e){res.status(500).json({error:"Fout"});} });
app.put("/api/quizzen/:id",async(req,res)=>{ if(!req.session.loggedIn)return res.status(401).json({error:"Niet ingelogd"}); try{const{naam,vragen}=req.body;const q=await Quiz.findByIdAndUpdate(req.params.id,{naam,vragen,bijgewerkt:new Date()},{new:true});if(!q)return res.status(404).json({error:"Niet gevonden"});res.json({success:true,quiz:q});}catch(e){res.status(500).json({error:"Fout"});} });
app.delete("/api/quizzen/:id",async(req,res)=>{ if(!req.session.loggedIn)return res.status(401).json({error:"Niet ingelogd"}); try{await Quiz.findByIdAndDelete(req.params.id);res.json({success:true});}catch(e){res.status(500).json({error:"Fout"});} });

app.post("/spelleider-login",(req,res)=>{ const p=(req.body.password||"").trim(); if(p===SPELLEIDER_PASSWORD){req.session.spelleider=true;return res.json({success:true});} return res.status(401).json({error:"Ongeldig wachtwoord"}); });
app.post("/api/join-aanvragen",(req,res)=>{ const{name,playerId}=req.body; if(!quizStarted)return res.status(400).json({error:"Quiz niet gestart"}); if(!allowedNames.includes(name))return res.status(403).json({error:"Naam niet toegestaan"}); const token="tok_"+Date.now()+"_"+Math.random().toString(36).slice(2,7); pendingApprovals[token]={name,playerId,time:Date.now()}; io.emit("gameUpdate",{type:"joinAanvraag",token,name}); return res.json({success:true,token}); });
app.post("/api/join-accepteren",(req,res)=>{ if(!req.session.spelleider)return res.status(401).json({error:"Niet ingelogd"}); const{token}=req.body; const a=pendingApprovals[token]; if(!a)return res.status(404).json({error:"Aanvraag niet gevonden"}); delete pendingApprovals[token]; io.emit("joinBeslissing",{token,beslissing:"geaccepteerd",name:a.name}); return res.json({success:true}); });
app.post("/api/join-afwijzen",(req,res)=>{ if(!req.session.spelleider)return res.status(401).json({error:"Niet ingelogd"}); const{token}=req.body; const a=pendingApprovals[token]; if(!a)return res.status(404).json({error:"Aanvraag niet gevonden"}); delete pendingApprovals[token]; io.emit("joinBeslissing",{token,beslissing:"afgewezen",name:a.name}); return res.json({success:true}); });
app.get("/api/join-aanvragen",(req,res)=>{ if(!req.session.spelleider)return res.status(401).json({error:"Niet ingelogd"}); res.json({aanvragen:Object.entries(pendingApprovals).map(([token,v])=>({token,...v}))}); });

app.post("/api/start-quiz", async(req,res)=>{ if(!req.session.loggedIn)return res.status(401).json({error:"Niet ingelogd"}); const{gameId,quizId}=req.body; if(!gameId)return res.json({error:"Game ID verplicht"}); if(!quizId)return res.json({error:"Selecteer eerst een quiz"}); try{ const quiz=await Quiz.findById(quizId); if(!quiz)return res.status(404).json({error:"Quiz niet gevonden"}); quizStarted=true; Object.assign(currentGame,{id:gameId,players:[],scores:{},quizId,quizData:quiz,huidigeVraag:-1,fase:"lobby",antwoorden:{},openGroepen:{},vraagStartTijd:null}); nextJoinId=1001; pendingPlayers=[{name:"Stef",joinId:1001}]; io.emit("gameUpdate",{type:"playersUpdate",data:currentGame}); io.emit("faseUpdate",{fase:"lobby"}); return res.json({success:true}); }catch(e){return res.status(500).json({error:"Fout bij starten quiz"});} });

app.post("/join",(req,res)=>{ const{name,gameId,character,playerId}=req.body; if(!quizStarted||gameId!==currentGame.id)return res.status(400).json({error:"Ongeldige Game ID"}); if(!allowedNames.includes(name))return res.status(403).json({error:"Naam niet toegestaan"}); const ep=currentGame.players.find(p=>p.name.toLowerCase()===name.toLowerCase()); if(ep){ if(ep.playerId!==playerId)return res.status(400).json({error:"Naam al in gebruik!"}); if(character){const t=currentGame.players.find(p=>p.character===character&&p.name!==name);if(t)return res.status(400).json({error:"Dit personage is al gekozen!"});ep.character=character;} io.emit("gameUpdate",{type:"playersUpdate",data:currentGame}); return res.json({success:true}); } if(character){const t=currentGame.players.find(p=>p.character===character&&p.name!==name);if(t)return res.status(400).json({error:"Dit personage is al gekozen!"});} currentGame.players.push({name,character:character||null,playerId,joinId:pendingPlayers.find(p=>p.name===name)?.joinId||nextJoinId++}); currentGame.scores[name]=0; io.emit("gameUpdate",{type:"playersUpdate",data:currentGame}); return res.json({success:true}); });

app.post("/reset-game",(req,res)=>{ if(!req.session.loggedIn)return res.status(401).json({error:"Niet ingelogd"}); quizStarted=false; Object.assign(currentGame,{players:[],scores:{},id:null,quizId:null,quizData:null,huidigeVraag:-1,fase:"lobby",antwoorden:{},openGroepen:{},vraagStartTijd:null}); nextJoinId=1001;pendingPlayers=[]; io.emit("gameUpdate",{type:"playersUpdate",data:currentGame}); io.emit("faseUpdate",{fase:"lobby"}); return res.json({success:true}); });

// ---------------- SOCKET.IO ----------------
io.on("connection", (socket) => {
    console.log("Nieuwe gebruiker verbonden");
    socket.emit("gameUpdate", { type:"playersUpdate", data:currentGame });
    socket.emit("phaseUpdate", "lobby");
    if (currentGame.fase && currentGame.fase !== "lobby") socket.emit("faseUpdate", buildFasePayload(currentGame.fase));

    socket.on("volgendeVraag", () => {
        if (!currentGame.quizData) return;
        const totaal = currentGame.quizData.vragen.length;
        if (currentGame.fase === "lobby" || currentGame.fase === "podium") {
            if (currentGame.huidigeVraag < totaal - 1) {
                currentGame.huidigeVraag++;
                currentGame.fase = "vraag";
                currentGame.antwoorden = {};
                currentGame.openGroepen = {};
                currentGame.vraagStartTijd = Date.now();
                io.emit("faseUpdate", buildFasePayload("vraag"));
            }
        } else if (currentGame.fase === "vraag") {
            if (isOpenVraag()) {
                currentGame.openGroepen = groepeerOpenAntwoorden();
                currentGame.fase = "keuring";
                io.emit("faseUpdate", buildFasePayload("keuring"));
            } else {
                verwerkScores();
                currentGame.fase = "resultaten";
                io.emit("faseUpdate", buildFasePayload("resultaten"));
            }
        } else if (currentGame.fase === "keuring") {
            verwerkScores();
            currentGame.fase = "resultaten";
            io.emit("faseUpdate", buildFasePayload("resultaten"));
        } else if (currentGame.fase === "resultaten") {
            const isLaatste = currentGame.huidigeVraag >= totaal - 1;
            currentGame.fase = isLaatste ? "eindpodium" : "podium";
            io.emit("faseUpdate", buildFasePayload(currentGame.fase));
        }
    });

    socket.on("vorigeVraag", () => {
        if (!currentGame.quizData) return;
        if (currentGame.fase === "vraag" && currentGame.huidigeVraag > 0) {
            currentGame.huidigeVraag--;
            currentGame.fase = "vraag";
            currentGame.antwoorden = {};
            currentGame.openGroepen = {};
            currentGame.vraagStartTijd = Date.now();
            io.emit("faseUpdate", buildFasePayload("vraag"));
        }
    });

    socket.on("springNaarVraag", ({ index }) => {
        if (!currentGame.quizData) return;
        const totaal = currentGame.quizData.vragen.length;
        if (index >= 0 && index < totaal) {
            currentGame.huidigeVraag = index;
            currentGame.fase = "vraag";
            currentGame.antwoorden = {};
            currentGame.openGroepen = {};
            currentGame.vraagStartTijd = Date.now();
            io.emit("faseUpdate", buildFasePayload("vraag"));
        }
    });

    // Meerkeuze antwoord
    socket.on("antwoord", ({ name, antwoordIndex }) => {
        if (currentGame.fase !== "vraag") return;
        if (!allowedNames.includes(name)) return;
        if (currentGame.antwoorden[name]) return;
        const nu = Date.now();
        const seconden = currentGame.vraagStartTijd ? (nu - currentGame.vraagStartTijd) / 1000 : 0;
        currentGame.antwoorden[name] = { antwoordIndex, seconden };
        socket.emit("antwoordBevestigd", { name, antwoordIndex });
        io.emit("antwoordUpdate", { aantalGeantwoord: Object.keys(currentGame.antwoorden).length, totaalSpelers: currentGame.players.length });
        if (!isOpenVraag() && Object.keys(currentGame.antwoorden).length >= currentGame.players.length) {
            verwerkScores(); currentGame.fase = "resultaten";
            io.emit("faseUpdate", buildFasePayload("resultaten"));
        }
    });

    // Open vraag antwoord
    socket.on("openAntwoord", ({ name, antwoordTekst }) => {
        if (currentGame.fase !== "vraag") return;
        if (!allowedNames.includes(name)) return;
        if (currentGame.antwoorden[name]) return;
        const nu = Date.now();
        const seconden = currentGame.vraagStartTijd ? (nu - currentGame.vraagStartTijd) / 1000 : 0;
        currentGame.antwoorden[name] = { antwoordTekst: (antwoordTekst || "").trim(), seconden };
        socket.emit("antwoordBevestigd", { name, antwoordTekst });
        io.emit("antwoordUpdate", { aantalGeantwoord: Object.keys(currentGame.antwoorden).length, totaalSpelers: currentGame.players.length });
    });

    // Host keurt een groep antwoorden goed of fout
    socket.on("keurAntwoord", ({ sleutel, beslissing }) => {
        if (!currentGame.openGroepen[sleutel]) return;
        currentGame.openGroepen[sleutel].beslissing = beslissing;
        io.emit("keuringUpdate", { sleutel, beslissing, openGroepen: currentGame.openGroepen });
    });

    socket.on("helpRequest", data => {
        io.emit("gameUpdate", { type:"helpRequest", name: data.name || "Niet bekend" });
    });
});

server.listen(PORT, "0.0.0.0", () => console.log("Server draait op poort " + PORT));
