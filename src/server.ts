import { Client } from '@stomp/stompjs'
import Fastify from 'fastify'
import { Database } from 'sqlite3'
import WebSocket from 'ws'

// Define a porta padrão
const APP_PORT = Number(process.env.APP_PORT) || 3001
const MQ_HOST = process.env.MQ_HOST || 'localhost'
const MQ_PORT = Number(process.env.PORT) || 61614

// Necessario para o pacote `ws` funcionar corretamente com o Node.js
Object.assign(global, { WebSocket })

const fastify = Fastify({ logger: true })
const db = new Database('inventory.db')

// Configuração do cliente ActiveMQ
const client = new Client({
    brokerURL: `ws://${MQ_HOST}:${MQ_PORT}/stomp`,
    connectHeaders: {
        login: 'admin',
        passcode: 'admin',
    },
    heartbeatIncoming: 4000, // Espera "heartbeats" do broker a cada 4 segundos
    heartbeatOutgoing: 4000, // Envia "heartbeats" ao broker a cada 4 segundos
    reconnectDelay: 5000,
    debug: (str) => console.log(str),
})

client.activate()
// Criação da tabela de estoque com `productId` autoincrement
db.serialize(() => {
    db.run(`
    CREATE TABLE IF NOT EXISTS inventory (
      productId INTEGER PRIMARY KEY AUTOINCREMENT,
      productName TEXT,
      quantity INTEGER
    )
  `)

    // Produtos pré-definidos
    const presetProducts = [
        { productName: 'Product1', quantity: 100 },
        { productName: 'Product2', quantity: 200 },
        { productName: 'Product3', quantity: 150 },
    ]

    // Inserir produtos pré-definidos se a tabela estiver vazia
    db.each('SELECT COUNT(*) AS count FROM inventory', (err, row: any) => {
        if (row.count === 0) {
            const insertStmt = db.prepare('INSERT INTO inventory (productName, quantity) VALUES (?, ?)')
            presetProducts.forEach((product) => {
                insertStmt.run(product.productName, product.quantity)
            })
            insertStmt.finalize()
            console.log('Predefined products added to inventory.')
        }
    })
})

// Configurar o comportamento do cliente STOMP ao conectar-se
client.onConnect = () => {
    client.subscribe('/queue/sales', (message) => {
        if (message.body) {
            const { productId, quantity } = JSON.parse(message.body)

            // Atualizar o estoque
            db.run('UPDATE inventory SET quantity = quantity - ? WHERE productId = ?', [quantity, productId], (err) => {
                if (err) {
                    console.error('Failed to update inventory:', err)
                } else {
                    console.log(`Inventory updated for product ${productId}`)
                }
            })
        }

        // Confirmar que a mensagem foi processada
        message.ack()
    })
}

// Endpoint para verificar o estoque
fastify.get('/inventory/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string }

    console.log(`Checking inventory for product ${productId}`)

    return new Promise((resolve, reject) => {
        db.get(
            'SELECT productId, productName, quantity FROM inventory WHERE productId = ?',
            [productId],
            (err, row) => {
                if (err) {
                    reply.status(500).send({ error: 'Failed to fetch inventory' })
                    reject(err)
                } else {
                    resolve(row ? row : { productId, quantity: 0 })
                }
            }
        )
    })
})

// Endpoint para verificar o estoque completo
fastify.get('/inventory', async (request, reply) => {
    return new Promise((resolve, reject) => {
        db.all('SELECT productId, productName, quantity FROM inventory', (err, rows) => {
            if (err) {
                reply.status(500).send({ error: 'Failed to fetch inventory' })
                reject(err)
            } else {
                resolve(rows)
            }
        })
    })
})

// Endpoint para adicionar um novo produto ao inventário
fastify.post('/inventory/add', async (request, reply) => {
    const { productName, quantity } = request.body as { productName: string; quantity: number }
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO inventory (productName, quantity) VALUES (?, ?)', [productName, quantity], function (err) {
            if (err) {
                reply.status(500).send({ error: 'Failed to add product to inventory' })
                reject(err)
            } else {
                resolve({
                    message: `Product added with ID ${this.lastID} and quantity ${quantity}`,
                    productId: this.lastID,
                })
            }
        })
    })
})

// Endpoint para atualizar a quantidade de um produto existente
fastify.post('/inventory/update', async (request, reply) => {
    const { productId, quantity } = request.body as { productId: number; quantity: number }
    return new Promise((resolve, reject) => {
        db.run('UPDATE inventory SET quantity = ? WHERE productId = ?', [quantity, productId], (err) => {
            if (err) {
                reply.status(500).send({ error: 'Failed to update product quantity' })
                reject(err)
            } else {
                resolve({ message: `Product ${productId} updated to quantity ${quantity}` })
            }
        })
    })
})

// Inicializando o servidor Fastify
const start = async () => {
    try {
        await fastify.listen({ port: Number(APP_PORT), host: '0.0.0.0' })
        console.log(`Inventory service running on http://localhost:${APP_PORT}`)
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}

start()
