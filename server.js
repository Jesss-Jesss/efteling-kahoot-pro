const express = require("express");
const { v4: uuidv4 } = require("uuid");

let currentGame = {
    id: null,
    players: []
};

let errors = [];

function logError(type, details) {
    errors.push({
        id: uuidv4(),
        type,
        details,
        time: new Date(),
        handled: false
    });
}
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

app.get("/", (req, res) => {
    res.redirect("/host");
});

let game = {
    code: Math.floor(100000 + Math.random() * 900000),
    players: []
};

io.on("connection", (socket) => {

    socket.on("joinGame", (data) => {
        if (parseInt(data.code) === game.code) {

            // voorkom dubbele naam
            if (game.players.find(p => p.name === data.name)) {
                socket.emit("nameTaken");
                return;
            }

            const player = {
                id: socket.id,
                name: data.name
            };

            game.players.push(player);
            socket.join("gameRoom");

            io.to("gameRoom").emit("updatePlayers", game.players);
        }
    });

    socket.on("disconnect", () => {
        game.players = game.players.filter(p => p.id !== socket.id);
        io.to("gameRoom").emit("updatePlayers", game.players);
    });

});

app.get("/host", (req, res) => {
    res.sendFile(__dirname + "/public/host.html");
});

app.get("/player", (req, res) => {
    res.sendFile(__dirname + "/public/player.html");
});

app.get("/gamecode", (req, res) => {
    res.json({ code: game.code });
});

http.listen(3000, () => {
    console.log("Server running on port 3000");
});

