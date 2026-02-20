const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// BELANGRIJK: body kunnen lezen
app.use(express.urlencoded({ extended: true }));

// Test homepage
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public/host-login.html"));
});

// Login POST
app.post("/host-login", (req, res) => {
    const password = (req.body.password || "").trim();

    console.log("Ontvangen wachtwoord:", JSON.stringify(password));

    if (password === "1234") {
        res.send("✅ LOGIN GELUKT");
    } else {
        res.send("❌ Ongeldig wachtwoord: " + password);
    }
});

app.listen(PORT, () => {
    console.log("Test server draait op poort " + PORT);
});
