const { Client, RichPresence } = require('discord.js-selfbot-v13');
const fs = require('fs'); // Juste pour lire le token.json au démarrage
const express = require('express');
const mongoose = require('mongoose');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000; // Render donne un port automatiquement
const API_KEY = "SECRET_KEY_XYVRAX";   // Ton mot de passe API
// Remplace ceci par ton lien MongoDB Atlas
const MONGO_URI = "mongodb+srv://TON_USER:TON_PASSWORD@cluster0.....mongodb.net/?retryWrites=true&w=majority";

// --- 1. CONNEXION MONGODB ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('[DB] Connecté à MongoDB Atlas'))
    .catch(err => console.error('[DB] Erreur de connexion:', err));

// --- 2. DÉFINITION DU MODÈLE (SCHEMA) ---
// C'est la structure de tes données dans la base
const historySchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    currentTag: String,
    history: [{
        type: { type: String }, // USERNAME, AVATAR, DISCRIM
        old: String,
        new: String,
        date: String
    }]
});

const HistoryModel = mongoose.model('UserHistory', historySchema);

// --- 3. INITIALISATION API (EXPRESS) ---
const app = express();

// Endpoint pour récupérer l'historique
app.get('/api/history/:query', async (req, res) => {
    if (req.query.key !== API_KEY) return res.status(403).json({ error: "Interdit" });

    const query = req.params.query;

    try {
        // A. Chercher par ID exact
        let data = await HistoryModel.findOne({ userId: query });

        // B. Si pas trouvé, chercher par Pseudo (partiel, insensible à la casse)
        if (!data) {
            // Regex pour chercher "query" n'importe où dans le pseudo
            data = await HistoryModel.findOne({ 
                currentTag: { $regex: query, $options: 'i' } 
            });
        }

        if (data) {
            return res.json({
                currentTag: data.currentTag,
                history: data.history,
                _foundId: data.userId
            });
        } else {
            return res.status(404).json({ error: "Introuvable" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`[API] Serveur en ligne sur le port ${PORT}`);
});


// --- 4. LOGIQUE DISCORD (Rich Presence + Tracker) ---

// Charger les tokens (On garde fs juste pour ça car c'est un fichier de config statique)
// Si tu es sur Render, tu peux mettre les tokens dans des Variables d'Environnement
let tokens = [];
try {
    tokens = JSON.parse(fs.readFileSync('./data/tokens.json', 'utf-8'));
} catch(e) { console.log("Pas de tokens.json trouvé, vérifiez la config."); }

function startClient(token) {
    const client = new Client({ checkUpdate: false });

    client.on('ready', async () => {
        console.log(`Logged in as ${client.user.tag}`);
        
        // Rich Presence (Ta configuration)
        const richPresence = new RichPresence(client)
            .setName('Xyvrax Corp')
            .setType('PLAYING')
            .setState('Rejoignez la Xyvrax Corp !')
            .setStartTimestamp(Date.now());
            // ... (Ajoute tes images/boutons ici comme avant)

        client.user.setPresence({ status: 'dnd', activities: [richPresence] });
    });

    // --- TRACKER CONNECTÉ À MONGODB ---
    client.on('userUpdate', async (oldUser, newUser) => {
        if (newUser.bot) return;

        let changes = [];
        const timestamp = new Date().toISOString();

        if (oldUser.username !== newUser.username) 
            changes.push({ type: 'USERNAME', old: oldUser.username, new: newUser.username, date: timestamp });
        
        if (oldUser.avatar !== newUser.avatar) 
            changes.push({ type: 'AVATAR', old: oldUser.avatarURL(), new: newUser.avatarURL(), date: timestamp });
        
        if (oldUser.discriminator !== newUser.discriminator) 
            changes.push({ type: 'DISCRIM', old: oldUser.discriminator, new: newUser.discriminator, date: timestamp });

        if (changes.length > 0) {
            try {
                // On cherche l'utilisateur dans la DB
                let userEntry = await HistoryModel.findOne({ userId: newUser.id });

                if (!userEntry) {
                    // Création si nouveau
                    userEntry = new HistoryModel({
                        userId: newUser.id,
                        currentTag: newUser.tag,
                        history: []
                    });
                }

                // Vérification anti-doublon (simple)
                const lastEntry = userEntry.history[userEntry.history.length - 1];
                const isDuplicate = lastEntry && lastEntry.date === timestamp && lastEntry.type === changes[0].type;

                if (!isDuplicate) {
                    userEntry.currentTag = newUser.tag;
                    // On ajoute les nouveaux changements à la liste
                    changes.forEach(c => userEntry.history.push(c));
                    
                    await userEntry.save(); // Sauvegarde dans le Cloud
                    console.log(`[TRACKER] ${newUser.tag} mis à jour dans MongoDB.`);
                }
            } catch (err) {
                console.error("[TRACKER ERROR]", err);
            }
        }
    });

    client.login(token).catch(e => console.log("Login error"));
}

tokens.forEach(startClient);
