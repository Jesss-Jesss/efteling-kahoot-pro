const socket = io();

fetch("/gamecode")
    .then(res => res.json())
    .then(data => {
        document.getElementById("gameCode").textContent = data.code;
    });

socket.on("updatePlayers", (players) => {
    const list = document.getElementById("playerList");
    list.innerHTML = "";

    players.forEach(p => {
        const li = document.createElement("li");
        li.textContent = p.name;
        list.appendChild(li);
    });
});
