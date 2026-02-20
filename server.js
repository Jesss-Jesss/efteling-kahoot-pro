const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// Zorg dat form data gelezen kan worden
app.use(express.urlencoded({ extended: true }));

// 🔥 BELANGRIJK: public map als static instellen
app.use(express.static(path.join(__dirname, "public")));

// Home → login pagina
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "host-login.html"));
});

// Login check
app.post("/host-login", (req, res) => {
    const password = (req.body.password || "").trim();

    console.log("Ontvangen:", password);

    if (password === "1234") {
        return res.send("✅ LOGIN GELUKT");
    }

    res.send("❌ Ongeldig wachtwoord");
});

app.listen(PORT, () => {
    console.log("Server draait op poort " + PORT);
});
