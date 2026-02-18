const socket = io();

socket.on("updatePlayers", (players) => {
    const list = document.getElementById("leaderboardList");
    list.innerHTML = "";

    players.forEach((p, index) => {
        const li = document.createElement("li");
        li.textContent = `${index + 1}. ${p.name}`;
        list.appendChild(li);
    });
});
