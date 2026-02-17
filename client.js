const socket = io();

if (window.location.pathname === "/host") {

    fetch("/gamecode")
        .then(res => res.json())
        .then(data => {
            document.getElementById("gameCode").innerText = data.code;

            const joinURL = window.location.origin + "/player";
            document.getElementById("qrCode").src =
                "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + joinURL;
        });

    socket.on("updatePlayers", (players) => {
        const list = document.getElementById("playerList");
        list.innerHTML = "";
        players.forEach(p => {
            const li = document.createElement("li");
            li.innerText = p.name;
            list.appendChild(li);
        });
    });
}

function joinGame() {
    const code = document.getElementById("codeInput").value;
    const name = document.getElementById("nameInput").value;

    socket.emit("joinGame", { code, name });
}

socket.on("nameTaken", () => {
    document.getElementById("status").innerText = "Naam is al bezet!";
});