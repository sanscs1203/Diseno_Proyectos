const express = require('express');
const mysql = require('mysql2');
const dgram = require('dgram');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

const db = mysql.createConnection({
    host: process.env.DB_HOST,    
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

db.connect(err => {
    if (err) {
        console.error("❌ Error al conectar MySQL:", err);
    } else {
        console.log("✅ Conectado a MySQL del servidor central");
    }
});

const udpServer = dgram.createSocket('udp4');

udpServer.bind(process.env.UDP_PORT, () => {
    console.log("✅ Servidor Secundario UDP escuchando en puerto", process.env.UDP_PORT);
});

function broadcastData(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

udpServer.on('message', async (msg, rinfo) => {
    try {
        const datos = JSON.parse(msg.toString());
        console.log('\n=== Mensaje UDP Recibido ===');
        console.log('Puerto: 4665');
        console.log(`Remitente: ${rinfo.address}:${rinfo.port}`);
        console.log('Contenido:', msg.toString());
        console.log('========================\n');

        const { latitude, longitude, timestamp } = datos;

        const checkQuery = `
            SELECT id FROM mensaje 
            WHERE TimeStamp = ? 
            AND Latitud = ? 
            AND Longitud = ? 
            LIMIT 1
        `;

        db.query(checkQuery, [timestamp, latitude, longitude], (checkErr, checkResults) => {
            if (checkErr) {
                console.error("❌ Error al verificar duplicado:", checkErr);
                return;
            }

            if (checkResults.length === 0) {
                const insertQuery = 'INSERT INTO mensaje (Latitud, Longitud, TimeStamp) VALUES (?, ?, ?)';
                db.query(insertQuery, [latitude, longitude, timestamp], (err, result) => {
                    if (err) {
                        console.error("❌ Error al guardar en MySQL:", err);
                    } else {
                        console.log("✅ Datos guardados en MySQL (servidor secundario)");
                        broadcastData({
                            id: result.insertId,
                            latitude,
                            longitude,
                            timestamp
                        });
                    }
                });
            } else {
                console.log("ℹ Dato duplicado, no se insertará");
                broadcastData({
                    id: checkResults[0].id,
                    latitude,
                    longitude,
                    timestamp
                });
            }
        });
    } catch (error) {
        console.error("❌ Error al procesar mensaje UDP:", error);
    }
});

app.get('/datos', async (req, res) => {
    const query = 'SELECT id, Latitud, Longitud, timestamp FROM mensaje ORDER BY id DESC LIMIT 1';
    db.query(query, (err, results) => {
        if (err) {
            console.error('❌ Error al obtener datos:', err);
            res.status(500).json({ error: 'Error al obtener los datos' });
        } else {
            res.json(results);
        }
    });
});

wss.on('connection', (ws) => {
    console.log('✅ Nueva conexión WebSocket establecida');
    
    const query = 'SELECT id, Latitud, Longitud, timestamp FROM mensaje ORDER BY id DESC LIMIT 1';
    db.query(query, (err, results) => {
        if (err) {
            console.error('❌ Error al obtener datos iniciales:', err);
        } else if (results.length > 0) {
            const data = {
                id: results[0].id,
                latitude: results[0].Latitud,
                longitude: results[0].Longitud,
                timestamp: results[0].timestamp
            };
            ws.send(JSON.stringify(data));
        }
    });

    const updateInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            const query = 'SELECT id, Latitud, Longitud, timestamp FROM mensaje ORDER BY id DESC LIMIT 1';
            db.query(query, (err, results) => {
                if (!err && results.length > 0) {
                    const data = {
                        id: results[0].id,
                        latitude: results[0].Latitud,
                        longitude: results[0].Longitud,
                        timestamp: results[0].timestamp
                    };
                    ws.send(JSON.stringify(data));
                }
            });
        }
    }, 1000);

    ws.on('error', (error) => {
        console.error('❌ Error en WebSocket:', error);
        clearInterval(updateInterval);
    });

    ws.on('close', () => {
        console.log('❌ Conexión WebSocket cerrada');
        clearInterval(updateInterval);
    });
});

server.listen(process.env.PORT, () => {
    console.log("✅ Servidor Secundario en puerto", process.env.PORT);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Error no manejado:', error);
});

process.on('SIGTERM', () => {
    console.log('🛑 Cerrando servidor...');
    server.close(() => {
        db.end();
        process.exit(0);
    });
});