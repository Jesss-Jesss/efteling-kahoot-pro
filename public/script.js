const eftelingConfig = {
    trigger: "efteling-schatbewaker-0909",
    pass: "sprookje123",
    myID: "EFTEL-" + Math.floor(1000 + Math.random() * 9000)
};

let peer, connections = {};

// Verwerk ID
function verwerkID() {
    const input = document.getElementById('id-input').value.trim();
    if (input === eftelingConfig.trigger) {
        document.getElementById('id-sectie').classList.add('hidden');
        document.getElementById('ww-sectie').classList.remove('hidden');
    } else if (input !== "") {
        document.getElementById('id-sectie').classList.add('hidden');
        document.getElementById('naam-sectie').classList.remove('hidden');
        sessionStorage.setItem('targetID', input.toUpperCase());
    }
}

// Verwerk Naam
function verwerkNaam() {
    const naam = document.getElementById('naam-input').value.trim();
    if (naam) {
        document.getElementById('naam-sectie').classList.add('hidden');
        document.getElementById('speler-veld').classList.remove('hidden');
        document.getElementById('info-tekst').innerText = `Welkom ${naam}! Wachten op de Schatbewaarder...`;
    }
}

// Master login
function masterLogin() {
    const ww = document.getElementById('ww-input').value;
    if (ww === eftelingConfig.pass) {
        document.getElementById('ww-sectie').classList.add('hidden');
        alert("Schatbewaarder ingelogd!");
    } else {
        document.getElementById('status-bericht').innerText = "Wachtwoord fout!";
    }
}

// Stuur antwoord (voor speler)
function stuurAntwoord() {
    const ans = document.getElementById('ans-input').value.trim();
    alert(`Je antwoord: ${ans}`);
}
