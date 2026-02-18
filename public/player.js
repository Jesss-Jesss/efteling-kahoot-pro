const socket = io();

function joinGame() {
    const name = document.getElementById("name").value;
    const code = document.getElementById("code").value;

    socket.emit("joinGame", { name, code });
}

socket.on("nameTaken", () => {
    document.getElementById("message").textContent = "Naam al in gebruik!";
});

socket.on("invalidCode", () => {
    document.getElementById("message").textContent = "Ongeldige game code!";
});

socket.on("updatePlayers", () => {
    document.getElementById("message").textContent = "Succesvol gejoined!";
});
