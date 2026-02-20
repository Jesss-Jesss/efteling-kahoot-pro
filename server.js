const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

const DASHBOARD_PASSWORD = "1234";

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.redirect("/host-login.html");
});

app.post("/host-login", (req, res) => {
    const password = (req.body.password || "").trim();

    if (password === DASHBOARD_PASSWORD) {
        return res.redirect("/host.html");
    }

    res.send(`
        <h2>❌ Ongeldig wachtwoord</h2>
        <a href="/host-login.html">Terug</a>
    `);
});

app.listen(PORT, () => {
    console.log("Server draait op poort " + PORT);
});
