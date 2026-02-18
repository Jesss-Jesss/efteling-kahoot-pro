const socket = io();

// Game code ophalen
fetch("/gamecode")
    .then(res => res.json())
    .then(data => {
        document.getElementById("gameCode").textContent = data.code;
    });

// Spelers realtime updaten
socket.on("updatePlayers", (players) => {
    const list = document.getElementById("playerList");
    list.innerHTML = "";

    players.forEach(player => {
        const li = document.createElement("li");
        li.textContent = player.name;
        list.appendChild(li);
    });
});

// Errors ophalen
function loadErrors() {
    fetch("/errors")
        .then(res => res.json())
        .then(data => {
            const list = document.getElementById("errorList");
            list.innerHTML = "";

            data.forEach(err => {
                const li = document.createElement("li");
                li.innerHTML = `
                    <b>${err.type}</b><br>
                    ${err.details.name || err.details.attemptedCode}<br>
                    ${new Date(err.time).toLocaleTimeString()}
                `;
                list.appendChild(li);
            });
        });
}

setInterval(loadErrors, 3000);
