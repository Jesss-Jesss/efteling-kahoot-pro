const socket = io();

// =====================
// Dashboard Elements
// =====================
const playersList = document.getElementById("playersList");
const errorsList = document.getElementById("errorsList");
const answersList = document.getElementById("answersList");
const gameCodeElem = document.getElementById("gameCode");

// =====================
// Player join
// =====================
if(document.getElementById("joinForm")) {
    const joinForm = document.getElementById("joinForm");
    joinForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("playerName").value.trim();
        const gameId = document.getElementById("gameId").value.trim();
        const character = document.getElementById("character").value;

        socket.emit("joinGame", { name, code: gameId, character });

        socket.on("invalidCode", () => {
            document.getElementById("joinError").innerText = "Ongeldige Game-ID!";
        });

        socket.on("nameTaken", () => {
            document.getElementById("joinError").innerText = "Naam al in gebruik!";
        });
    });
}

// =====================
// Dashboard Updates
// =====================
socket.on("updatePlayers", (players) => {
    playersList.innerHTML = "";
    players.forEach(p => {
        const li = document.createElement("li");
        li.textContent = `${p.name} (${p.character || "Geen"})`;
        const kickBtn = document.createElement("button");
        kickBtn.innerText = "Kick";
        kickBtn.onclick = () => {
            socket.emit("kickPlayer", p.id);
        };
        li.appendChild(kickBtn);
        playersList.appendChild(li);
    });
});

socket.on("updateErrors", (errors) => {
    errorsList.innerHTML = "";
    errors.forEach(err => {
        const li = document.createElement("li");
        li.textContent = `[${err.type}] ${err.details.name || ""}: ${err.details.msg || ""}`;
        const handleBtn = document.createElement("button");
        handleBtn.innerText = "Afgehandeld";
        handleBtn.onclick = () => {
            socket.emit("handleError", err.id);
        };
        li.appendChild(handleBtn);
        errorsList.appendChild(li);
    });
});
