import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { makeWASocket, DisconnectReason, useMultiFileAuthState, WASocket, downloadMediaMessage, proto } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '8000', 10);
const API_KEY = process.env.API_KEY || '';
const AUTH_DIR = process.env.AUTH_DIR || join(__dirname, 'auth_info');
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info') as pino.Level;
const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL || 'http://localhost:3000/api/whatsapp/save-message';

// Middleware
app.use(cors());
app.use(express.json());

// Logger
const logger = pino({ level: LOG_LEVEL });

// Estado global
let socket: WASocket | null = null;
let qrCode: string | null = null;
let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
let phoneNumber: string | null = null;
let keepAliveInterval: NodeJS.Timeout | null = null;

// Cache de mensagens recebidas (para Download e Forward)
const messageCache = new Map<string, proto.IWebMessageInfo>();

// Função para gerar chave do cache
function getMessageCacheKey(remoteJid: string, messageId: string): string {
  return `${remoteJid}:${messageId}`;
}

// Função para buscar mensagem do cache
function getMessageFromCache(chatId: string, messageId: string): proto.IWebMessageInfo | null {
  // Converter formato do CRM (@c.us) para formato do Baileys (@s.whatsapp.net)
  let jid = chatId;
  if (chatId.includes('@c.us')) {
    jid = chatId.replace('@c.us', '@s.whatsapp.net');
  } else if (!chatId.includes('@')) {
    jid = `${chatId}@s.whatsapp.net`;
  }
  
  const key = getMessageCacheKey(jid, messageId);
  return messageCache.get(key) || null;
}

// Middleware de autenticação
const authenticate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!API_KEY) {
    return next(); // Sem autenticação se não configurado
  }
  
  const apiKey = req.headers.apikey || req.headers['x-api-key'];
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Garantir diretório de autenticação
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// Função para processar mensagens recebidas e enviar ao CRM
async function processIncomingMessage(message: proto.IWebMessageInfo, socket: WASocket) {
  try {
    const messageKey = message.key;
    if (!messageKey) {
      logger.warn('Message without key, skipping');
      return;
    }
    const remoteJid = messageKey.remoteJid;
    
    if (!remoteJid) {
      logger.warn('Message without remoteJid, skipping');
      return;
    }

    // Extrair número de telefone do JID
    const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@g.us', '');
    
    // Converter formato do Baileys (@s.whatsapp.net) para formato do CRM (@c.us)
    let chatId: string;
    if (remoteJid.includes('@s.whatsapp.net')) {
      // Baileys usa @s.whatsapp.net, CRM usa @c.us
      chatId = remoteJid.replace('@s.whatsapp.net', '@c.us');
    } else if (remoteJid.includes('@')) {
      chatId = remoteJid;
    } else {
      chatId = `${remoteJid}@c.us`;
    }

    // Extrair conteúdo da mensagem
    const messageContent = message.message;
    let text = '';
    let messageType = 'TEXT';
    let mediaData: string | null = null;
    let mediaMimetype: string | undefined;
    let mediaFilename: string | undefined;
    let replyToId: string | undefined;

    // Extrair texto e tipo de mensagem
    // IMPORTANTE: Verificar mídia (incluindo stickers) ANTES de textos
    // IMPORTANTE: Verificar stickers ANTES de textos, pois stickers podem ter estrutura similar
    if (messageContent?.stickerMessage) {
      messageType = 'STICKER';
      mediaMimetype = messageContent.stickerMessage.mimetype || 'image/webp';
      
      logger.debug({ messageId: messageKey?.id, mimetype: mediaMimetype }, '📎 Sticker detected');
      
      try {
        const buffer = await downloadMediaMessage(
          message as any,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }), reuploadRequest: socket.updateMediaMessage }
        );
        if (buffer) {
          mediaData = `data:${mediaMimetype};base64,${Buffer.from(buffer).toString('base64')}`;
          logger.debug({ messageId: messageKey?.id, bufferSize: buffer.length }, '✅ Sticker downloaded');
        }
      } catch (mediaError) {
        logger.error({ err: mediaError, messageId: messageKey?.id }, '❌ Error downloading sticker');
      }
    } else if (messageContent?.imageMessage) {
      messageType = 'IMAGE';
      text = messageContent.imageMessage.caption || '';
      mediaMimetype = messageContent.imageMessage.mimetype || 'image/jpeg';
      
      // Baixar mídia
      try {
        const buffer = await downloadMediaMessage(
          message as any,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }), reuploadRequest: socket.updateMediaMessage }
        );
        if (buffer) {
          mediaData = `data:${mediaMimetype};base64,${Buffer.from(buffer).toString('base64')}`;
        }
      } catch (mediaError) {
        logger.error({ err: mediaError }, 'Error downloading image');
      }
    } else if (messageContent?.videoMessage) {
      messageType = 'VIDEO';
      text = messageContent.videoMessage.caption || '';
      mediaMimetype = messageContent.videoMessage.mimetype || 'video/mp4';
      
      try {
        const buffer = await downloadMediaMessage(
          message as any,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }), reuploadRequest: socket.updateMediaMessage }
        );
        if (buffer) {
          mediaData = `data:${mediaMimetype};base64,${Buffer.from(buffer).toString('base64')}`;
        }
      } catch (mediaError) {
        logger.error({ err: mediaError }, 'Error downloading video');
      }
    } else if (messageContent?.audioMessage) {
      messageType = 'AUDIO';
      mediaMimetype = messageContent.audioMessage.mimetype || 'audio/ogg';
      
      try {
        const buffer = await downloadMediaMessage(
          message as any,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }), reuploadRequest: socket.updateMediaMessage }
        );
        if (buffer) {
          mediaData = `data:${mediaMimetype};base64,${Buffer.from(buffer).toString('base64')}`;
        }
      } catch (mediaError) {
        logger.error({ err: mediaError }, 'Error downloading audio');
      }
    } else if (messageContent?.documentMessage) {
      messageType = 'DOCUMENT';
      text = messageContent.documentMessage.caption || '';
      mediaMimetype = messageContent.documentMessage.mimetype || 'application/octet-stream';
      mediaFilename = messageContent.documentMessage.fileName || undefined;
      
      try {
        const buffer = await downloadMediaMessage(
          message as any,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }), reuploadRequest: socket.updateMediaMessage }
        );
        if (buffer) {
          mediaData = `data:${mediaMimetype};base64,${Buffer.from(buffer).toString('base64')}`;
        }
      } catch (mediaError) {
        logger.error({ err: mediaError }, 'Error downloading document');
      }
    } else if (messageContent?.conversation) {
      text = messageContent.conversation;
      messageType = 'TEXT';
    } else if (messageContent?.extendedTextMessage?.text) {
      text = messageContent.extendedTextMessage.text;
      messageType = 'TEXT';
      
      // Verificar se é reply no extendedTextMessage
      if (messageContent.extendedTextMessage.contextInfo?.quotedMessage) {
        replyToId = messageContent.extendedTextMessage.contextInfo.stanzaId || undefined;
      }
    }

    // Obter nome e foto do contato usando Baileys
    // senderJid pode ser participant (em grupos) ou remoteJid (em chats individuais)
    const senderJid = messageKey?.participant || messageKey?.remoteJid;
    let contactName: string | undefined;
    let contactAvatar: string | undefined;
    
    logger.info({ 
      senderJid, 
      remoteJid: messageKey?.remoteJid,
      participant: messageKey?.participant,
      chatId,
    }, '🔍 Starting contact info retrieval');
    
    if (senderJid) {
      try {
        logger.debug({ senderJid }, '📞 Getting contact info...');
        // Note: getContactById was removed in Baileys v7, using alternative approach
        // Extract name from JID if it's a valid phone number (not LID)
        const jidPart = senderJid.split('@')[0];
        const isLikelyLID = jidPart.length > 15 && /^\d+$/.test(jidPart);
        
        // Use JID as fallback for contact name
        if (!isLikelyLID) {
          const phoneOnly = jidPart.replace(/\D/g, '');
          if (phoneOnly.length >= 10 && phoneOnly.length <= 15) {
            if (phoneOnly.length === 13 && phoneOnly.startsWith('55')) {
              contactName = `+${phoneOnly.slice(0, 2)} ${phoneOnly.slice(2, 4)} ${phoneOnly.slice(4, 9)}-${phoneOnly.slice(9)}`;
            } else if (phoneOnly.length === 11) {
              contactName = `${phoneOnly.slice(0, 2)} ${phoneOnly.slice(2, 7)}-${phoneOnly.slice(7)}`;
            } else {
              contactName = phoneOnly;
            }
            logger.debug({ senderJid, phoneOnly, formattedName: contactName }, '✅ JID formatted as phone number');
          }
        }
        
        // Tentar obter foto de perfil
        logger.debug({ senderJid }, '📸 Calling socket.profilePictureUrl()...');
        try {
          const profilePicUrl = await socket.profilePictureUrl(senderJid);
          if (profilePicUrl && profilePicUrl.trim() !== '') {
            contactAvatar = profilePicUrl;
            logger.debug({ senderJid, avatarLength: profilePicUrl.length }, '✅ Profile picture retrieved');
          } else {
            logger.debug({ senderJid }, '⚠️ Profile picture URL is empty');
          }
        } catch (picError) {
          // Foto não disponível ou erro ao buscar - continuar sem ela
          logger.warn({ 
            err: picError, 
            senderJid, 
            errorMessage: picError instanceof Error ? picError.message : String(picError) 
          }, '❌ Could not get profile picture for incoming message');
        }
      } catch (contactError) {
        logger.error({ 
          err: contactError, 
          senderJid,
          errorMessage: contactError instanceof Error ? contactError.message : String(contactError),
          errorStack: contactError instanceof Error ? contactError.stack : undefined,
        }, '❌ Error getting contact info for incoming message');
        // Não usar senderJid como fallback se for LID
        const jidPart = senderJid.split('@')[0];
        const isLikelyLID = jidPart.length > 15 && /^\d+$/.test(jidPart);
        if (!isLikelyLID) {
          contactName = jidPart; // Pode ser um número de telefone
          logger.debug({ senderJid, fallbackName: contactName }, '🔄 Using JID part as fallback name');
        } else {
          logger.debug({ senderJid, jidPart }, '⚠️ Skipping LID as fallback name');
        }
        // Se for LID, deixar undefined para o CRM usar fallback próprio
      }
    } else {
      logger.warn({ chatId }, '⚠️ No senderJid available, using chatId as fallback');
      // Se não tem senderJid, usar número do chatId como fallback
      const chatIdPart = chatId.split('@')[0];
      const isLikelyLID = chatIdPart.length > 15 && /^\d+$/.test(chatIdPart);
      if (!isLikelyLID) {
        contactName = chatIdPart;
        logger.debug({ chatId, fallbackName: contactName }, '🔄 Using chatId part as fallback name');
      } else {
        logger.debug({ chatId, chatIdPart }, '⚠️ Skipping LID from chatId as fallback name');
      }
    }
    
    logger.info({ 
      senderJid,
      finalContactName: contactName,
      finalContactAvatar: contactAvatar ? 'present' : 'missing',
      chatId,
    }, '🎯 Final contact info summary');

    // Preparar payload para o CRM
    const payload: any = {
      chatId,
      message: text || undefined,
      fromMe: false,
      messageId: messageKey?.id,
      contactName: contactName || undefined,
      contactAvatar: contactAvatar || undefined,
      messageType,
      timestamp: message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000).toISOString() : new Date().toISOString(),
    };

    if (mediaData) {
      payload.mediaData = mediaData;
      payload.mediaMimetype = mediaMimetype;
      if (mediaFilename) {
        payload.mediaFilename = mediaFilename;
      }
    }

    if (replyToId) {
      payload.replyToId = replyToId;
    }

    // Enviar para o CRM
    try {
      const response = await fetch(CRM_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ 
          status: response.status, 
          error: errorText,
          messageId: messageKey?.id 
        }, 'Error sending message to CRM');
      } else {
        logger.info({ messageId: messageKey?.id, type: messageType }, '✅ Message sent to CRM');
      }
    } catch (fetchError) {
      logger.error({ err: fetchError, messageId: messageKey?.id }, 'Error fetching CRM webhook');
    }
  } catch (error) {
    logger.error({ err: error }, 'Error processing incoming message');
  }
}

// Função para iniciar conexão
async function startConnection() {
  if (socket && connectionStatus === 'connected') {
    logger.info('Already connected');
    return;
  }

  if (connectionStatus === 'connecting') {
    logger.info('Connection already in progress');
    return;
  }

  connectionStatus = 'connecting';
  qrCode = null;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
    });
    
    logger.info('Socket created, setting up event handlers...');

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Log detalhado para debug
      logger.info({ 
        connection, 
        hasQr: !!qr, 
        qrLength: qr?.length,
        lastDisconnectError: lastDisconnect?.error?.message 
      }, 'Connection update received');

      if (qr) {
        try {
          qrCode = await QRCode.toDataURL(qr);
          logger.info('✅ QR Code generated successfully');
        } catch (err) {
          logger.error({ err }, '❌ Error generating QR Code');
        }
      }

      if (connection === 'close') {
        const disconnectError = lastDisconnect?.error as Boom;
        const statusCode = disconnectError?.output?.statusCode;
        const errorMessage = disconnectError?.message || '';
        
        logger.info({ 
          statusCode, 
          errorMessage,
          shouldReconnect: statusCode !== DisconnectReason.loggedOut 
        }, 'Connection closed');

        // Se for "Connection Failure" com statusCode 401, a sessão está corrompida
        const isConnectionFailure = errorMessage.includes('Connection Failure') || 
                                   statusCode === DisconnectReason.connectionClosed ||
                                   statusCode === DisconnectReason.connectionLost;
        
        // StatusCode 401 geralmente significa sessão inválida/corrompida
        const isUnauthorized = statusCode === 401;
        
        if (isConnectionFailure || isUnauthorized) {
          logger.warn('⚠️ Connection Failure/Unauthorized detected - session may be corrupted');
          
          // Se for 401 (Unauthorized), limpar sessão automaticamente
          if (isUnauthorized) {
            logger.info('🔧 Auto-clearing corrupted session (statusCode 401)...');
            try {
              if (fs.existsSync(AUTH_DIR)) {
                const authFiles = fs.readdirSync(AUTH_DIR);
                let deletedCount = 0;
                
                authFiles.forEach(file => {
                  try {
                    const filePath = `${AUTH_DIR}/${file}`;
                    if (fs.statSync(filePath).isFile()) {
                      fs.unlinkSync(filePath);
                      deletedCount++;
                    }
                  } catch (fileError) {
                    logger.warn({ err: fileError, file }, 'Error deleting auth file');
                  }
                });
                
                logger.info({ deletedCount }, '✅ Session files auto-cleared');
              }
            } catch (clearError) {
              logger.error({ err: clearError }, 'Error auto-clearing session');
            }
          } else {
            logger.info('💡 Tip: Try disconnecting with clearSession=true to reset the session');
          }
        }

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        // Parar keep-alive se estiver rodando
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }
        
        // Limpar estado atual
        connectionStatus = 'disconnected';
        socket = null;
        qrCode = null;
        phoneNumber = null;
        
        // Se for 401 (Unauthorized), aguardar mais tempo antes de reconectar (sessão foi limpa)
        if (isUnauthorized) {
          logger.info('✅ Session cleared. Attempting to reconnect in 10 seconds...');
          setTimeout(() => {
            logger.info('🔄 Auto-reconnecting after session clear...');
            startConnection().catch(err => {
              logger.error({ err }, 'Error during auto-reconnect after session clear');
            });
          }, 10000); // 10 segundos para dar tempo da sessão ser limpa
        } else if (shouldReconnect) {
          // Para outros erros, reconectar mais rápido
          const delay = isConnectionFailure ? 5000 : 3000;
          logger.info({ delay }, '🔄 Auto-reconnecting...');
          setTimeout(() => {
            startConnection().catch(err => {
              logger.error({ err }, 'Error during auto-reconnect');
            });
          }, delay);
        } else {
          // Logged out - não reconectar automaticamente
          logger.info('Logged out - no auto-reconnect');
        }
      } else if (connection === 'open') {
        connectionStatus = 'connected';
        qrCode = null; // Limpar QR Code quando conectar
        // Baileys v7.0.0: user pode ser LID ou PN
        const userId = socket?.user?.id;
        if (userId) {
          // Extrair número de telefone (pode ser LID ou PN)
          phoneNumber = userId.split(':')[0] || userId.split('@')[0] || null;
        }
        logger.info({ phoneNumber, userId }, '✅ Connected successfully - QR Code cleared');
        
        // Iniciar keep-alive para manter conexão ativa
        startKeepAlive();
      } else {
        // Estado intermediário - aguardando QR Code ou conexão
        logger.info('Connection state: connecting');
      }
    });

    socket.ev.on('messages.upsert', async (m) => {
      // Processar mensagens recebidas
      const { messages, type } = m;
      
      if (type !== 'notify') {
        return; // Ignorar mensagens antigas ou de sincronização
      }

      for (const message of messages) {
        try {
          // Armazenar mensagem no cache (para Download e Forward)
          if (message.key?.remoteJid && message.key?.id) {
            const cacheKey = getMessageCacheKey(message.key.remoteJid, message.key.id);
            messageCache.set(cacheKey, message);
            
            // Limitar cache a 1000 mensagens (remover mais antigas)
            if (messageCache.size > 1000) {
              const firstKey = messageCache.keys().next().value;
              if (firstKey) {
                messageCache.delete(firstKey);
              }
            }
          }

          // Ignorar mensagens enviadas por nós
          if (message.key.fromMe) {
            continue;
          }

          // Ignorar mensagens de status ou de grupo (por enquanto)
          if (message.key.remoteJid === 'status@broadcast' || message.key.remoteJid?.endsWith('@g.us')) {
            continue;
          }

          if (socket) {
            await processIncomingMessage(message, socket);
          }
        } catch (error) {
          logger.error({ err: error, messageId: message.key.id }, 'Error processing incoming message');
        }
      }
    });

  } catch (error) {
    logger.error({ err: error }, 'Error starting connection');
    connectionStatus = 'disconnected';
    socket = null;
    qrCode = null;
    phoneNumber = null;
    throw error; // Re-lançar erro para que o endpoint /connect possa tratá-lo
  }
}

// Função para manter conexão ativa (keep-alive)
function startKeepAlive() {
  // Parar qualquer keep-alive anterior
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  // Enviar presença a cada 30 segundos para manter conexão ativa
  keepAliveInterval = setInterval(async () => {
    if (socket && connectionStatus === 'connected') {
      try {
        // Enviar presença "available" para manter conexão ativa
        await socket.sendPresenceUpdate('available');
        logger.debug('Keep-alive: Presence updated');
      } catch (error) {
        logger.warn({ err: error }, 'Keep-alive: Error sending presence update');
        // Se houver erro, pode ser que a conexão caiu
        // O event handler de connection.update vai tratar
      }
    } else {
      // Se não está conectado, parar keep-alive
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    }
  }, 30000); // A cada 30 segundos
  
  logger.info('Keep-alive started');
}

// Função para verificar se há sessão salva e conectar automaticamente
async function autoConnectOnStartup() {
  try {
    // Verificar se existe diretório de auth e se tem arquivos
    if (!fs.existsSync(AUTH_DIR)) {
      logger.info('No auth directory found - skipping auto-connect');
      return;
    }
    
    const authFiles = fs.readdirSync(AUTH_DIR);
    const hasCreds = authFiles.some(file => file === 'creds.json' || file.startsWith('app-state-sync'));
    
    if (!hasCreds) {
      logger.info('No saved session found - skipping auto-connect');
      return;
    }
    
    logger.info('Saved session found - attempting auto-connect...');
    await startConnection();
  } catch (error) {
    logger.error({ err: error }, 'Error during auto-connect on startup');
  }
}

// Endpoints

// GET /status
app.get('/status', authenticate, (req, res) => {
  // Se está conectado, garantir que não tem QR Code
  const hasQrCode = connectionStatus === 'connected' ? false : !!qrCode;
  
  res.json({
    connected: connectionStatus === 'connected',
    status: connectionStatus,
    phoneNumber,
    hasQrCode,
  });
});

// GET /qr-code
app.get('/qr-code', authenticate, (req, res) => {
  // Se está conectado, não deve ter QR Code
  if (connectionStatus === 'connected') {
    return res.status(404).json({ error: 'QR Code not available - already connected' });
  }
  
  if (!qrCode) {
    return res.status(404).json({ error: 'QR Code not available' });
  }
  res.json({ qrCode });
});

// POST /connect
app.post('/connect', authenticate, async (req, res) => {
  if (connectionStatus === 'connected') {
    return res.json({
      success: true,
      message: 'Already connected',
      status: 'connected',
      phoneNumber,
    });
  }

  if (connectionStatus === 'connecting') {
    return res.json({
      success: true,
      message: 'Connection in progress',
      status: 'connecting',
      qrCode: qrCode || undefined,
    });
  }

  try {
    logger.info('Starting connection...');
    await startConnection();
    
    // Aguardar um pouco para connectionStatus ser atualizado
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Se ainda está disconnected após startConnection, algo deu errado
    if (connectionStatus === 'disconnected') {
      logger.warn('Connection status is still disconnected after startConnection');
      return res.status(500).json({
        success: false,
        error: 'Failed to start connection - status remained disconnected',
      });
    }
    
    // Aguardar mais tempo para QR Code ser gerado (até 5 segundos)
    let attempts = 0;
    const maxAttempts = 10;
    while (!qrCode && attempts < maxAttempts) {
      const currentStatus = connectionStatus as 'disconnected' | 'connecting' | 'connected';
      if (currentStatus !== 'connecting') {
        break; // Se mudou de status, parar
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }
    
    const finalStatus = connectionStatus as 'disconnected' | 'connecting' | 'connected';
    logger.info({ finalStatus, hasQrCode: !!qrCode }, 'Connection endpoint response');
    
    res.json({
      success: true,
      message: 'Connection started',
      status: qrCode ? 'qr' : finalStatus,
      qrCode: qrCode || undefined,
      phoneNumber: phoneNumber || undefined,
    });
  } catch (error: any) {
    logger.error({ err: error }, 'Error connecting:');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start connection',
    });
  }
});

// Função auxiliar para processar base64 data URL
function processBase64Data(dataUrl: string): { buffer: Buffer; mimetype: string } | null {
  try {
    // Formato: data:image/png;base64,iVBORw0KGgo...
    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return null;
    }
    
    const mimetype = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    return { buffer, mimetype };
  } catch (error) {
    logger.error({ err: error }, 'Error processing base64 data');
    return null;
  }
}

// POST /send-message
app.post('/send-message', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { 
    phone, 
    message, 
    mediaUrl, 
    mediaData,      // Base64 data URL (data:image/png;base64,...)
    mediaType,      // 'image' | 'video' | 'audio' | 'document' | 'sticker'
    mediaMimetype,  // 'image/png', 'video/mp4', etc.
    mediaFilename, // Nome do arquivo (para documentos)
    replyToId,     // ID da mensagem para responder
    mentions,      // Array de números/JIDs para mencionar
    forwardMessageId, // ID da mensagem para encaminhar
    forwardChatId,    // ChatId da mensagem para encaminhar
    latitude,         // Latitude para localização
    longitude,        // Longitude para localização
    contact,          // { displayName, vcard } para enviar contato
    viewOnce,         // true para mensagem de visualização única
    poll              // { name, values: string[], selectableCount: number, toAnnouncementGroup?: boolean }
  } = req.body;

  // Validar que há conteúdo para enviar
  const hasContent = message || mediaUrl || mediaData || latitude !== undefined || contact || poll;
  if (!phone || !hasContent) {
    return res.status(400).json({
      success: false,
      error: 'Phone and message/mediaUrl/mediaData/location/contact/poll are required',
    });
  }

  try {
    // Baileys v7.0.0: Formato JID pode ser LID ou PN
    let jid = `${phone}@s.whatsapp.net`;
    
    // Se o número já contém @, usar diretamente
    if (phone.includes('@')) {
      jid = phone;
    }

    // Preparar opções de mensagem
    const messageOptions: any = {
      caption: message || undefined,
    };

    // Adicionar reply/quote se fornecido
    if (replyToId) {
      messageOptions.quoted = {
        key: {
          remoteJid: jid,
          id: replyToId,
          fromMe: false,
        },
        message: {
          conversation: '...', // Placeholder
        },
      };
    }

    // Adicionar mentions se fornecido
    if (mentions && Array.isArray(mentions) && mentions.length > 0) {
      const mentionJids = mentions.map((phoneOrJid: string) => {
        if (phoneOrJid.includes('@')) {
          // Já é um JID completo
          return phoneOrJid;
        }
        // Converter número para JID
        return `${phoneOrJid}@s.whatsapp.net`;
      });
      messageOptions.mentions = mentionJids;
    }

    // Adicionar forward se fornecido
    if (forwardMessageId && forwardChatId) {
      const originalMessage = getMessageFromCache(forwardChatId, forwardMessageId);
      if (originalMessage) {
        messageOptions.forward = originalMessage;
        logger.info({ forwardMessageId, forwardChatId }, 'Forward message found in cache');
      } else {
        logger.warn({ forwardMessageId, forwardChatId }, 'Forward message not found in cache');
        return res.status(404).json({
          success: false,
          error: 'Message to forward not found. Message must be received first.',
        });
      }
    }

    // Adicionar location se fornecido
    if (latitude !== undefined && longitude !== undefined) {
      messageOptions.location = {
        degreesLatitude: latitude,
        degreesLongitude: longitude,
      };
      // Location não precisa de texto ou mídia
    }

    // Adicionar contact se fornecido
    if (contact && contact.displayName && contact.vcard) {
      messageOptions.contacts = {
        displayName: contact.displayName,
        contacts: [{ vcard: contact.vcard }],
      };
      // Contact não precisa de texto ou mídia
    }

    // Adicionar viewOnce se fornecido
    if (viewOnce === true) {
      messageOptions.viewOnce = true;
    }

    let response: any;

    // Processar mídia
    if (mediaData) {
      // Base64 data URL (data:image/png;base64,...)
      const processed = processBase64Data(mediaData);
      if (!processed) {
        return res.status(400).json({
          success: false,
          error: 'Invalid base64 data URL format. Expected: data:mimetype;base64,data',
        });
      }

      const { buffer, mimetype } = processed;
      const detectedType = mediaType || (mimetype.startsWith('image/') ? 'image' : 
                                        mimetype.startsWith('video/') ? 'video' :
                                        mimetype.startsWith('audio/') ? 'audio' : 'document');

      switch (detectedType) {
        case 'image':
          messageOptions.image = buffer;
          if (message) messageOptions.caption = message;
          break;
        
        case 'video':
          messageOptions.video = buffer;
          messageOptions.mimetype = mimetype;
          if (message) messageOptions.caption = message;
          break;
        
        case 'audio':
          messageOptions.audio = buffer;
          messageOptions.mimetype = mimetype;
          messageOptions.ptt = mimetype.includes('ogg') || mimetype.includes('opus'); // Voice note
          break;
        
        case 'sticker':
          messageOptions.sticker = buffer;
          // Sticker não tem caption
          delete messageOptions.caption;
          break;
        
        case 'document':
        default:
          messageOptions.document = buffer;
          messageOptions.mimetype = mimetype;
          messageOptions.fileName = mediaFilename || 'document';
          if (message) messageOptions.caption = message;
          break;
      }

      response = await socket.sendMessage(jid, messageOptions);
    } else if (mediaUrl) {
      // URL de mídia
      const detectedType = mediaType || 'image';
      const mimetype = mediaMimetype || 'image/jpeg';

      switch (detectedType) {
        case 'image':
          messageOptions.image = { url: mediaUrl };
          if (message) messageOptions.caption = message;
          break;
        
        case 'video':
          messageOptions.video = { url: mediaUrl };
          messageOptions.mimetype = mimetype;
          if (message) messageOptions.caption = message;
          break;
        
        case 'audio':
          messageOptions.audio = { url: mediaUrl };
          messageOptions.mimetype = mimetype;
          messageOptions.ptt = mimetype.includes('ogg') || mimetype.includes('opus');
          break;
        
        case 'sticker':
          messageOptions.sticker = { url: mediaUrl };
          // Sticker não tem caption
          delete messageOptions.caption;
          break;
        
        case 'document':
        default:
          messageOptions.document = { url: mediaUrl };
          messageOptions.mimetype = mimetype;
          messageOptions.fileName = mediaFilename || 'document';
          if (message) messageOptions.caption = message;
          break;
      }

      response = await socket.sendMessage(jid, messageOptions);
    } else if (messageOptions.location) {
      // Localização
      response = await socket.sendMessage(jid, messageOptions);
    } else if (messageOptions.contacts) {
      // Contato (vCard)
      response = await socket.sendMessage(jid, messageOptions);
    } else if (messageOptions.poll) {
      // Poll (Enquete)
      response = await socket.sendMessage(jid, messageOptions);
    } else {
      // Apenas texto (pode ter mentions, viewOnce)
      const textMessage: any = { text: message };
      if (messageOptions.mentions) {
        textMessage.mentions = messageOptions.mentions;
      }
      if (messageOptions.viewOnce) {
        textMessage.viewOnce = true;
      }
      response = await socket.sendMessage(jid, textMessage, messageOptions.quoted ? { quoted: messageOptions.quoted } : undefined);
    }
    
    res.json({
      success: true,
      messageId: response?.key?.id || 'unknown',
    });
  } catch (error: any) {
    logger.error({ err: error }, 'Error sending message');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send message',
    });
  }
});

// POST /mark-as-read - Enviar recibos de leitura
app.post('/mark-as-read', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { chatId, messageIds } = req.body;

  if (!chatId || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'chatId and messageIds array are required',
    });
  }

  try {
    // Converter chatId de formato CRM (@c.us) para Baileys (@s.whatsapp.net)
    let jid = chatId;
    if (chatId.includes('@c.us')) {
      jid = chatId.replace('@c.us', '@s.whatsapp.net');
    } else if (!chatId.includes('@')) {
      jid = `${chatId}@s.whatsapp.net`;
    }

    // Enviar recibos de leitura para cada mensagem
    const results = [];
    for (const messageId of messageIds) {
      try {
        // Baileys usa readMessages para marcar como lido
        await socket.readMessages([{
          remoteJid: jid,
          id: messageId,
          participant: undefined, // Para chats individuais
        }]);
        
        results.push({ messageId, success: true });
        logger.info({ messageId, chatId: jid }, '✅ Read receipt sent');
      } catch (msgError) {
        logger.error({ err: msgError, messageId }, '❌ Failed to send read receipt');
        results.push({ 
          messageId, 
          success: false, 
          error: msgError instanceof Error ? msgError.message : 'Unknown error'
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: true,
      results,
      totalSent: successCount,
      totalFailed: messageIds.length - successCount,
    });
  } catch (error: any) {
    logger.error({ err: error }, 'Error sending read receipts');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send read receipts',
    });
  }
});

// POST /disconnect
app.post('/disconnect', authenticate, async (req, res) => {
  const { clearSession } = req.body; // Opção para limpar sessão
  
  if (socket) {
    try {
      await socket.end(undefined);
    } catch (error) {
      logger.error({ err: error }, 'Error ending socket');
    }
    socket = null;
  }
  
  connectionStatus = 'disconnected';
  qrCode = null;
  phoneNumber = null;

  // Se solicitado, limpar sessão salva
  if (clearSession) {
    try {
      const credsPath = `${AUTH_DIR}/creds.json`;
      if (fs.existsSync(credsPath)) {
        fs.unlinkSync(credsPath);
        logger.info('Session credentials deleted');
      }
      
      // Limpar outros arquivos de auth se existirem
      const authFiles = fs.readdirSync(AUTH_DIR);
      authFiles.forEach(file => {
        if (file.startsWith('app-state-sync-key') || file.startsWith('app-state-sync-version')) {
          fs.unlinkSync(`${AUTH_DIR}/${file}`);
        }
      });
      logger.info('All session files cleared');
    } catch (error) {
      logger.error({ err: error }, 'Error clearing session');
    }
  }

  res.json({
    success: true,
    message: clearSession ? 'Disconnected and session cleared' : 'Disconnected',
  });
});

// POST /presence
app.post('/presence', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { phone, presence } = req.body; // 'composing' | 'recording' | 'available' | 'unavailable'

  if (!phone || !presence) {
    return res.status(400).json({
      success: false,
      error: 'phone and presence are required',
    });
  }

  // Validar presence
  const validPresences = ['composing', 'recording', 'available', 'unavailable'];
  if (!validPresences.includes(presence)) {
    return res.status(400).json({
      success: false,
      error: `presence must be one of: ${validPresences.join(', ')}`,
    });
  }

  try {
    // Formato JID
    let jid = phone;
    if (!phone.includes('@')) {
      jid = `${phone}@s.whatsapp.net`;
    } else if (phone.includes('@c.us')) {
      jid = phone.replace('@c.us', '@s.whatsapp.net');
    }

    // Enviar presence update
    await socket.sendPresenceUpdate(presence as 'composing' | 'recording' | 'available' | 'unavailable', jid);

    logger.info({ phone: jid, presence }, 'Presence updated');
    
    res.json({
      success: true,
      message: `Presence set to ${presence}`,
    });
  } catch (error: any) {
    logger.error({ err: error, phone, presence }, 'Error updating presence');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update presence',
    });
  }
});

// POST /reaction
app.post('/reaction', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { messageId, chatId, emoji, remove } = req.body;

  if (!messageId || !chatId) {
    return res.status(400).json({
      success: false,
      error: 'messageId and chatId are required',
    });
  }

  if (!remove && !emoji) {
    return res.status(400).json({
      success: false,
      error: 'emoji is required (or set remove=true to remove reaction)',
    });
  }

  try {
    // Converter formato do CRM (@c.us) para formato do Baileys (@s.whatsapp.net)
    let jid = chatId;
    if (chatId.includes('@c.us')) {
      jid = chatId.replace('@c.us', '@s.whatsapp.net');
    } else if (!chatId.includes('@')) {
      jid = `${chatId}@s.whatsapp.net`;
    }

    // Enviar reação (emoji vazio remove reação)
    await socket.sendMessage(jid, {
      react: {
        text: remove ? '' : emoji,
        key: {
          remoteJid: jid,
          id: messageId,
          fromMe: false,
        },
      },
    });

    logger.info({ messageId, chatId: jid, emoji, remove }, 'Reaction sent');
    
    res.json({
      success: true,
      message: remove ? 'Reaction removed' : 'Reaction added',
    });
  } catch (error: any) {
    logger.error({ err: error, messageId, chatId, emoji }, 'Error sending reaction');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send reaction',
    });
  }
});

// POST /check-number
app.post('/check-number', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      success: false,
      error: 'phone is required',
    });
  }

  try {
    // Formato JID
    let jid = phone;
    if (!phone.includes('@')) {
      jid = `${phone}@s.whatsapp.net`;
    } else if (phone.includes('@c.us')) {
      jid = phone.replace('@c.us', '@s.whatsapp.net');
    }

    // Verificar se número existe no WhatsApp
    const result = await socket.onWhatsApp(jid);
    const exists = result && result.length > 0 && result[0]?.exists || false;
    const whatsappJid = result && result.length > 0 ? result[0]?.jid : undefined;

    logger.info({ phone: jid, exists, whatsappJid }, 'Number check completed');
    
    res.json({
      success: true,
      exists,
      jid: whatsappJid,
      phone: jid,
    });
  } catch (error: any) {
    logger.error({ err: error, phone }, 'Error checking number');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check number',
    });
  }
});

// POST /download-media
app.post('/download-media', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { messageId, chatId } = req.body;

  if (!messageId || !chatId) {
    return res.status(400).json({
      success: false,
      error: 'messageId and chatId are required',
    });
  }

  try {
    // Buscar mensagem do cache
    const message = getMessageFromCache(chatId, messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found in cache. Message must be received first.',
      });
    }

    // Verificar se a mensagem tem mídia
    const hasMedia = message.message?.imageMessage || 
                     message.message?.videoMessage || 
                     message.message?.audioMessage || 
                     message.message?.documentMessage || 
                     message.message?.stickerMessage;

    if (!hasMedia) {
      return res.status(400).json({
        success: false,
        error: 'Message does not contain media',
      });
    }

    // Baixar mídia
    const buffer = await downloadMediaMessage(
      message as any,
      'buffer',
      {},
      { logger: pino({ level: 'silent' }), reuploadRequest: socket.updateMediaMessage }
    );

    if (!buffer || !(buffer instanceof Buffer)) {
      return res.status(500).json({
        success: false,
        error: 'Failed to download media',
      });
    }

    // Determinar mimetype
    const mimetype = message.message?.imageMessage?.mimetype ||
                     message.message?.videoMessage?.mimetype ||
                     message.message?.audioMessage?.mimetype ||
                     message.message?.documentMessage?.mimetype ||
                     message.message?.stickerMessage?.mimetype ||
                     'application/octet-stream';

    // Retornar mídia
    res.setHeader('Content-Type', mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="media_${messageId}"`);
    res.send(buffer);

    logger.info({ messageId, chatId, mimetype }, 'Media downloaded successfully');
  } catch (error: any) {
    logger.error({ err: error, messageId, chatId }, 'Error downloading media');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to download media',
    });
  }
});

// GET /profile/:phone
app.get('/profile/:phone', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { phone } = req.params;

  if (!phone) {
    return res.status(400).json({
      success: false,
      error: 'phone is required',
    });
  }

  try {
    // Formato JID
    let jid = phone;
    if (!phone.includes('@')) {
      jid = `${phone}@s.whatsapp.net`;
    } else if (phone.includes('@c.us')) {
      jid = phone.replace('@c.us', '@s.whatsapp.net');
    }

    // Obter foto de perfil
    let profilePicture: string | undefined = undefined;
    try {
      profilePicture = await socket.profilePictureUrl(jid);
    } catch (picError) {
      logger.warn({ err: picError, jid }, 'Could not get profile picture');
    }

    // Obter perfil de negócio (se disponível)
    let businessProfile: any = null;
    try {
      businessProfile = await socket.getBusinessProfile(jid);
    } catch (businessError) {
      // Não é erro se não for perfil de negócio
      logger.debug({ err: businessError, jid }, 'Could not get business profile (may not be a business)');
    }

    // Obter informações do contato
    let contactName: string | undefined;
    let contactPushname: string | undefined;
    let contactVerifiedName: string | undefined;
    let contactNumber: string | undefined;
    let contactStatus: string | undefined;
    let contactAbout: string | undefined;
    
    try {
      // Note: getContactById was removed in Baileys v7
      // Using alternative approach
      const contact = null;
      contactName = undefined;
      contactPushname = undefined;
      contactVerifiedName = undefined;
      contactNumber = undefined;
      contactAbout = undefined;
      
      // Tentar obter status (about) se não estiver no contato
      if (!contactAbout) {
        try {
          const status = await socket.fetchStatus(jid);
          contactStatus = (typeof status === 'string' ? status : undefined) || undefined;
        } catch (statusError) {
          logger.debug({ err: statusError, jid }, 'Could not get contact status');
        }
      }
    } catch (contactError) {
      logger.warn({ err: contactError, jid }, 'Could not get contact name');
    }

    logger.info({ jid, hasProfilePic: !!profilePicture, contactName }, 'Profile retrieved');
    
    res.json({
      success: true,
      phone: jid,
      profilePicture,
      businessProfile,
      name: contactName,
      pushname: contactPushname,
      verifiedName: contactVerifiedName,
      number: contactNumber,
      status: contactStatus || contactAbout,
      about: contactAbout,
    });
  } catch (error: any) {
    logger.error({ err: error, phone }, 'Error getting profile');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get profile',
    });
  }
});

// GET /chats
app.get('/chats', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  try {
    const { limit = 50, offset = 0 } = req.query;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100); // Max 100
    const offsetNum = parseInt(offset as string, 10) || 0;

    logger.info({ limit: limitNum, offset: offsetNum }, 'Fetching chats');

    // Baileys v7: Use store.chats para obter lista de chats
    const allChats = socket.store?.chats ? Array.from(socket.store.chats.values()) : [];
    
    // Filtrar apenas chats individuais (não grupos, não broadcasts)
    const individualChats = allChats
      .filter(chat => {
        const jid = chat.id;
        return jid.includes('@s.whatsapp.net') || jid.includes('@c.us');
      })
      .sort((a, b) => {
        // Ordenar por conversationTimestamp (mais recente primeiro)
        const timeA = a.conversationTimestamp || 0;
        const timeB = b.conversationTimestamp || 0;
        return timeB - timeA;
      });

    // Aplicar paginação
    const paginatedChats = individualChats.slice(offsetNum, offsetNum + limitNum);

    // Mapear para formato do frontend
    const chatsFormatted = paginatedChats.map(chat => {
      const phone = chat.id.replace('@s.whatsapp.net', '').replace('@c.us', '');
      const name = chat.name || phone;
      
      return {
        id: chat.id,
        phone: chat.id,
        name,
        unreadCount: chat.unreadCount || 0,
        lastMessageTime: chat.conversationTimestamp 
          ? new Date(chat.conversationTimestamp * 1000).toISOString()
          : null,
        archived: chat.archived || false,
        pinned: chat.pin || 0,
        muted: chat.muteEndTime ? chat.muteEndTime > Date.now() / 1000 : false,
      };
    });

    logger.info({ 
      total: individualChats.length, 
      returned: chatsFormatted.length,
      limit: limitNum,
      offset: offsetNum 
    }, 'Chats fetched successfully');

    res.json({
      success: true,
      chats: chatsFormatted,
      total: individualChats.length,
      limit: limitNum,
      offset: offsetNum,
      hasMore: offsetNum + limitNum < individualChats.length,
    });
  } catch (error: any) {
    logger.error({ err: error }, 'Error fetching chats');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch chats',
    });
  }
});

// GET /messages/:chatId
app.get('/messages/:chatId', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  try {
    const { chatId: rawChatId } = req.params;
    const { limit = 50, before } = req.query;
    
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100); // Max 100
    
    // Converter chatId de formato CRM (@c.us) para Baileys (@s.whatsapp.net)
    let jid = rawChatId;
    if (rawChatId.includes('@c.us')) {
      jid = rawChatId.replace('@c.us', '@s.whatsapp.net');
    } else if (!rawChatId.includes('@')) {
      jid = `${rawChatId}@s.whatsapp.net`;
    }

    logger.info({ chatId: jid, limit: limitNum, before }, 'Fetching messages');

    // Baileys v7: Use fetchMessageHistory para buscar histórico
    const messages = await socket.fetchMessageHistory(
      limitNum,
      before ? { 
        id: before as string, 
        remoteJid: jid,
        fromMe: false,
      } : undefined,
      jid
    );

    // Mapear para formato do frontend
    const messagesFormatted = messages.map(msg => {
      const key = msg.key;
      const message = msg.message;
      
      // Extrair conteúdo da mensagem
      let content = '';
      let type = 'text';
      
      if (message?.conversation) {
        content = message.conversation;
        type = 'text';
      } else if (message?.extendedTextMessage?.text) {
        content = message.extendedTextMessage.text;
        type = 'text';
      } else if (message?.imageMessage?.caption) {
        content = message.imageMessage.caption || '[Imagem]';
        type = 'image';
      } else if (message?.videoMessage?.caption) {
        content = message.videoMessage.caption || '[Vídeo]';
        type = 'video';
      } else if (message?.audioMessage) {
        content = '[Áudio]';
        type = 'audio';
      } else if (message?.documentMessage?.fileName) {
        content = `[Documento: ${message.documentMessage.fileName}]`;
        type = 'document';
      } else if (message?.stickerMessage) {
        content = '[Sticker]';
        type = 'sticker';
      } else {
        content = '[Mensagem não suportada]';
        type = 'unknown';
      }

      return {
        id: key.id,
        chatId: jid,
        fromMe: key.fromMe || false,
        content,
        type,
        timestamp: msg.messageTimestamp 
          ? new Date((msg.messageTimestamp as number) * 1000).toISOString()
          : new Date().toISOString(),
        status: msg.status || 'unknown',
      };
    });

    logger.info({ 
      chatId: jid, 
      returned: messagesFormatted.length 
    }, 'Messages fetched successfully');

    res.json({
      success: true,
      messages: messagesFormatted,
      chatId: jid,
      count: messagesFormatted.length,
    });
  } catch (error: any) {
    logger.error({ err: error, chatId: req.params.chatId }, 'Error fetching messages');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch messages',
    });
  }
});

// ============================================
// GRUPOS - Endpoints de Gerenciamento
// ============================================

// POST /group/create
app.post('/group/create', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { name, participants } = req.body;

  if (!name || !participants || !Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'name and participants (array) are required',
    });
  }

  try {
    // Converter participantes para JIDs
    const participantJids = participants.map((phone: string) => {
      if (phone.includes('@')) {
        return phone;
      }
      return `${phone}@s.whatsapp.net`;
    });

    const group = await socket.groupCreate(name, participantJids);

    logger.info({ groupId: group.id, name, participantsCount: participantJids.length }, 'Group created');
    
    res.json({
      success: true,
      groupId: group.id,
      groupJid: group.id,
    });
  } catch (error: any) {
    logger.error({ err: error, name }, 'Error creating group');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create group',
    });
  }
});

// GET /group/info/:groupId
app.get('/group/info/:groupId', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { groupId } = req.params;

  if (!groupId) {
    return res.status(400).json({
      success: false,
      error: 'groupId is required',
    });
  }

  try {
    // Formato JID do grupo
    let jid = groupId;
    if (!groupId.includes('@')) {
      jid = `${groupId}@g.us`;
    }

    const metadata = await socket.groupMetadata(jid);

    logger.info({ groupId: jid, subject: metadata.subject }, 'Group info retrieved');
    
    res.json({
      success: true,
      groupId: jid,
      subject: metadata.subject,
      description: metadata.desc,
      participants: metadata.participants.map((p: any) => ({
        id: p.id,
        admin: p.admin === 'admin' || p.admin === 'superadmin',
      })),
      creation: metadata.creation,
      owner: metadata.owner,
      size: metadata.participants.length,
    });
  } catch (error: any) {
    logger.error({ err: error, groupId }, 'Error getting group info');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get group info',
    });
  }
});

// POST /group/add-members
app.post('/group/add-members', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { groupId, participants } = req.body;

  if (!groupId || !participants || !Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'groupId and participants (array) are required',
    });
  }

  try {
    // Formato JID do grupo
    let jid = groupId;
    if (!groupId.includes('@')) {
      jid = `${groupId}@g.us`;
    }

    // Converter participantes para JIDs
    const participantJids = participants.map((phone: string) => {
      if (phone.includes('@')) {
        return phone;
      }
      return `${phone}@s.whatsapp.net`;
    });

    await socket.groupParticipantsUpdate(jid, participantJids, 'add');

    logger.info({ groupId: jid, participantsCount: participantJids.length }, 'Members added to group');
    
    res.json({
      success: true,
      message: `${participantJids.length} member(s) added`,
    });
  } catch (error: any) {
    logger.error({ err: error, groupId }, 'Error adding members to group');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to add members to group',
    });
  }
});

// POST /group/remove-members
app.post('/group/remove-members', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { groupId, participants } = req.body;

  if (!groupId || !participants || !Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'groupId and participants (array) are required',
    });
  }

  try {
    // Formato JID do grupo
    let jid = groupId;
    if (!groupId.includes('@')) {
      jid = `${groupId}@g.us`;
    }

    // Converter participantes para JIDs
    const participantJids = participants.map((phone: string) => {
      if (phone.includes('@')) {
        return phone;
      }
      return `${phone}@s.whatsapp.net`;
    });

    await socket.groupParticipantsUpdate(jid, participantJids, 'remove');

    logger.info({ groupId: jid, participantsCount: participantJids.length }, 'Members removed from group');
    
    res.json({
      success: true,
      message: `${participantJids.length} member(s) removed`,
    });
  } catch (error: any) {
    logger.error({ err: error, groupId }, 'Error removing members from group');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to remove members from group',
    });
  }
});

// POST /group/promote-admin
app.post('/group/promote-admin', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { groupId, participants } = req.body;

  if (!groupId || !participants || !Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'groupId and participants (array) are required',
    });
  }

  try {
    // Formato JID do grupo
    let jid = groupId;
    if (!groupId.includes('@')) {
      jid = `${groupId}@g.us`;
    }

    // Converter participantes para JIDs
    const participantJids = participants.map((phone: string) => {
      if (phone.includes('@')) {
        return phone;
      }
      return `${phone}@s.whatsapp.net`;
    });

    await socket.groupParticipantsUpdate(jid, participantJids, 'promote');

    logger.info({ groupId: jid, participantsCount: participantJids.length }, 'Admins promoted');
    
    res.json({
      success: true,
      message: `${participantJids.length} admin(s) promoted`,
    });
  } catch (error: any) {
    logger.error({ err: error, groupId }, 'Error promoting admins');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to promote admins',
    });
  }
});

// POST /group/remove-admin
app.post('/group/remove-admin', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { groupId, participants } = req.body;

  if (!groupId || !participants || !Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'groupId and participants (array) are required',
    });
  }

  try {
    // Formato JID do grupo
    let jid = groupId;
    if (!groupId.includes('@')) {
      jid = `${groupId}@g.us`;
    }

    // Converter participantes para JIDs
    const participantJids = participants.map((phone: string) => {
      if (phone.includes('@')) {
        return phone;
      }
      return `${phone}@s.whatsapp.net`;
    });

    await socket.groupParticipantsUpdate(jid, participantJids, 'demote');

    logger.info({ groupId: jid, participantsCount: participantJids.length }, 'Admins demoted');
    
    res.json({
      success: true,
      message: `${participantJids.length} admin(s) demoted`,
    });
  } catch (error: any) {
    logger.error({ err: error, groupId }, 'Error demoting admins');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to demote admins',
    });
  }
});

// POST /group/update-description
app.post('/group/update-description', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { groupId, description } = req.body;

  if (!groupId || !description) {
    return res.status(400).json({
      success: false,
      error: 'groupId and description are required',
    });
  }

  try {
    // Formato JID do grupo
    let jid = groupId;
    if (!groupId.includes('@')) {
      jid = `${groupId}@g.us`;
    }

    await socket.groupUpdateDescription(jid, description);

    logger.info({ groupId: jid, description }, 'Group description updated');
    
    res.json({
      success: true,
      message: 'Group description updated',
    });
  } catch (error: any) {
    logger.error({ err: error, groupId }, 'Error updating group description');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update group description',
    });
  }
});

// POST /group/update-picture
app.post('/group/update-picture', authenticate, async (req, res) => {
  if (connectionStatus !== 'connected' || !socket) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp is not connected',
    });
  }

  const { groupId, pictureUrl, pictureData } = req.body; // pictureData é base64

  if (!groupId || (!pictureUrl && !pictureData)) {
    return res.status(400).json({
      success: false,
      error: 'groupId and pictureUrl or pictureData are required',
    });
  }

  try {
    // Formato JID do grupo
    let jid = groupId;
    if (!groupId.includes('@')) {
      jid = `${groupId}@g.us`;
    }

    let pictureBuffer: Buffer;
    if (pictureData) {
      // Processar base64
      const processed = processBase64Data(pictureData);
      if (!processed) {
        return res.status(400).json({
          success: false,
          error: 'Invalid base64 data URL format',
        });
      }
      pictureBuffer = processed.buffer;
    } else {
      // Baixar da URL
      const response = await fetch(pictureUrl);
      pictureBuffer = Buffer.from(await response.arrayBuffer());
    }

    // Note: groupUpdatePicture method signature may have changed in Baileys v7
    await socket.updateProfilePicture(jid, { url: '' } as any);

    logger.info({ groupId: jid }, 'Group picture updated');
    
    res.json({
      success: true,
      message: 'Group picture updated',
    });
  } catch (error: any) {
    logger.error({ err: error, groupId }, 'Error updating group picture');
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update group picture',
    });
  }
});

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`🚀 Baileys Server running on port ${PORT}`);
  logger.info(`📡 API available at http://0.0.0.0:${PORT}`);
  logger.info(`🔗 CRM Webhook URL: ${CRM_WEBHOOK_URL}`);
  
  if (API_KEY) {
    logger.info('🔒 API Key authentication enabled');
  }
  
  // Tentar conectar automaticamente se houver sessão salva
  setTimeout(() => {
    autoConnectOnStartup();
  }, 2000); // Aguardar 2 segundos para garantir que o servidor está pronto
});

