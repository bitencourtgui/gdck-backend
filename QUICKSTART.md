# 🚀 Quick Start - Deploy no Fly.io

**5 minutos para ter seu servidor WhatsApp rodando gratuitamente!**

## 📦 O que já está pronto:

✅ Dockerfile otimizado  
✅ Configuração do Fly.io (fly.toml)  
✅ Script automatizado de deploy  
✅ Volume persistente configurado  

---

## 🎯 Deploy em 3 Passos

### 1️⃣ Instalar Fly CLI

```bash
# Linux/macOS
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell como Admin)
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

### 2️⃣ Login no Fly.io

```bash
fly auth login
```

(Vai abrir o navegador para você fazer login/criar conta - é grátis!)

### 3️⃣ Deploy Automático

```bash
cd gdck-backend
./deploy.sh
```

**Pronto!** 🎉

O script vai:
- ✅ Criar a aplicação
- ✅ Criar o volume persistente
- ✅ Configurar secrets
- ✅ Fazer o deploy
- ✅ Te dar a URL pública

---

## 🔑 Configurações Importantes

Durante o deploy, você será perguntado sobre:

### API_KEY (Recomendado)
Chave de segurança para proteger sua API.
```
Exemplo: minha-chave-super-secreta-123456
```

### CRM_WEBHOOK_URL (Obrigatório)
URL do seu frontend na Vercel.
```
Exemplo: https://gdck-frontend-crm.vercel.app/api/whatsapp/save-message
```

---

## 🌐 Após o Deploy

1. **Copie a URL gerada** (algo como `https://gdck-baileys-server.fly.dev`)

2. **Configure no Frontend (Vercel)**:
   - Vá no Dashboard da Vercel
   - Settings → Environment Variables
   - Adicione:
     ```
     BAILEYS_SERVER_URL=https://gdck-baileys-server.fly.dev
     ```
   - Faça redeploy do frontend

3. **Teste a conexão**:
   - Acesse seu frontend
   - Vá em configurações de WhatsApp
   - Clique em "Conectar"
   - Escaneie o QR Code
   - ✅ Pronto!

---

## 📊 Comandos Úteis

```bash
# Ver logs em tempo real
fly logs

# Ver status
fly status

# Abrir dashboard
fly dashboard

# Reiniciar
fly apps restart
```

---

## 🐛 Problemas?

### "App name already taken"
Edite `fly.toml` e mude o nome do app na primeira linha.

### "Volume not found"
Execute: `fly volumes create whatsapp_auth_data --region gru --size 1`

### Ver logs de erro
Execute: `fly logs`

---

## 📚 Documentação Completa

Para mais detalhes, veja [FLY_IO_DEPLOY.md](./FLY_IO_DEPLOY.md)

---

## ✅ Tudo Funcionando?

Parabéns! Você tem agora:
- ✅ Servidor WhatsApp rodando 24/7
- ✅ Volume persistente (sessões não perdem)
- ✅ 100% Gratuito ($5/mês de crédito)
- ✅ URL pública HTTPS
- ✅ Auto-scaling e health checks

**Custo: $0/mês** (dentro do free tier) 🎉

