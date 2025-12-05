# 🚀 Deploy no Fly.io - Guia Completo

Este guia te ajudará a fazer deploy do servidor Baileys no Fly.io **100% GRATUITO**.

## 📋 Pré-requisitos

1. **Conta no Fly.io** (gratuita, sem cartão necessário)
   - Acesse: https://fly.io/app/sign-up
   - Faça cadastro com GitHub (recomendado)

2. **CLI do Fly.io instalado**
   ```bash
   # Linux/macOS
   curl -L https://fly.io/install.sh | sh
   
   # Windows (PowerShell)
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```

3. **Docker instalado** (opcional, mas recomendado para testar local)
   - https://docs.docker.com/get-docker/

---

## 🔧 Passo 1: Configurar CLI do Fly.io

```bash
# Fazer login no Fly.io
fly auth login

# Verificar se está logado
fly auth whoami
```

---

## 🚀 Passo 2: Criar a Aplicação no Fly.io

```bash
# Entrar no diretório do backend
cd /home/guilhermebitencourt/gdck/ia/gdck-backend

# Criar aplicação (NÃO fazer deploy ainda)
fly apps create gdck-baileys-server

# OU deixar o Fly.io escolher um nome único
fly apps create
```

**Nota:** Se o nome `gdck-baileys-server` já estiver em uso, escolha outro nome único.

---

## 💾 Passo 3: Criar Volume Persistente (para sessões WhatsApp)

```bash
# Criar volume de 1GB (grátis) na região de São Paulo
fly volumes create whatsapp_auth_data --region gru --size 1

# Verificar volume criado
fly volumes list
```

**Importante:** O volume é essencial para manter as sessões do WhatsApp entre deploys!

---

## 🔐 Passo 4: Configurar Variáveis de Ambiente

```bash
# API_KEY (OBRIGATÓRIO para segurança)
fly secrets set API_KEY="sua-chave-secreta-super-forte-aqui"

# CRM_WEBHOOK_URL (URL do seu frontend na Vercel)
fly secrets set CRM_WEBHOOK_URL="https://gdck-frontend-crm.vercel.app/api/whatsapp/save-message"

# Verificar secrets configurados
fly secrets list
```

### Variáveis de Ambiente Disponíveis:

| Variável | Obrigatória | Padrão | Descrição |
|----------|-------------|--------|-----------|
| `API_KEY` | ⚠️ Recomendado | - | Chave de autenticação da API |
| `CRM_WEBHOOK_URL` | ✅ Sim | - | URL do webhook do CRM |
| `PORT` | ❌ Não | 8080 | Porta do servidor (definida no fly.toml) |
| `NODE_ENV` | ❌ Não | production | Ambiente de execução |
| `AUTH_DIR` | ❌ Não | /data/auth_info | Diretório de autenticação (volume) |
| `LOG_LEVEL` | ❌ Não | info | Nível de log (debug, info, warn, error) |

---

## 🎯 Passo 5: Deploy Inicial

```bash
# Deploy da aplicação
fly deploy

# Acompanhar logs em tempo real
fly logs
```

**O que vai acontecer:**
1. ✅ Docker build será executado
2. ✅ Imagem será enviada para o Fly.io
3. ✅ Aplicação será iniciada
4. ✅ Health check será executado
5. ✅ URL pública será gerada

---

## 🌐 Passo 6: Obter URL da Aplicação

```bash
# Ver informações da aplicação
fly info

# URL será algo como:
# https://gdck-baileys-server.fly.dev
```

**Copie essa URL!** Você precisará dela para configurar no frontend.

---

## 🔗 Passo 7: Atualizar Frontend (Vercel)

No dashboard da Vercel, adicione a variável de ambiente:

```
BAILEYS_SERVER_URL=https://gdck-baileys-server.fly.dev
```

E faça um redeploy do frontend.

---

## 🧪 Passo 8: Testar a API

```bash
# Health check
curl https://gdck-baileys-server.fly.dev/health

# Status da conexão
curl -H "apikey: sua-chave-secreta" \
  https://gdck-baileys-server.fly.dev/status

# Iniciar conexão (gerar QR Code)
curl -X POST \
  -H "apikey: sua-chave-secreta" \
  -H "Content-Type: application/json" \
  https://gdck-baileys-server.fly.dev/connect
```

---

## 📊 Comandos Úteis

### Ver Logs em Tempo Real
```bash
fly logs
```

### Ver Status da Aplicação
```bash
fly status
```

### Escalar Recursos (se necessário no futuro)
```bash
# Aumentar memória para 512MB
fly scale memory 512

# Ver configuração atual
fly scale show
```

### SSH na Máquina (debug)
```bash
fly ssh console
```

### Reiniciar Aplicação
```bash
fly apps restart gdck-baileys-server
```

### Ver Volumes
```bash
fly volumes list
```

### Ver Métricas e Uso
```bash
fly dashboard
```

---

## 🔄 Atualizações Futuras

Sempre que fizer mudanças no código:

```bash
# 1. Commit as mudanças no Git
git add .
git commit -m "Update baileys server"
git push

# 2. Deploy no Fly.io
cd /home/guilhermebitencourt/gdck/ia/gdck-backend
fly deploy

# 3. Verificar logs
fly logs
```

---

## 💰 Custos (Plano Gratuito)

✅ **Você tem $5/mês de crédito GRATUITO permanente!**

**Uso estimado com esta configuração:**
- 1 VM (256MB RAM, 1 CPU compartilhado): ~$3/mês
- 1GB Volume persistente: ~$0.15/mês
- Bandwidth (até 160GB/mês): Grátis

**Total: ~$3.15/mês (coberto pelo crédito de $5!)** 🎉

---

## 🐛 Troubleshooting

### Aplicação não inicia
```bash
# Ver logs detalhados
fly logs

# Verificar health check
fly checks list

# SSH para debug
fly ssh console
```

### Volume não está montado
```bash
# Verificar volumes
fly volumes list

# Verificar se o nome do volume está correto no fly.toml
# O nome deve ser: whatsapp_auth_data
```

### Erro de memória (OOM)
```bash
# Aumentar memória para 512MB
fly scale memory 512
```

### Reset completo (último recurso)
```bash
# Destruir aplicação
fly apps destroy gdck-baileys-server

# Recriar do zero (seguir passos 2-5)
```

---

## 📚 Documentação Oficial

- Fly.io Docs: https://fly.io/docs/
- Fly.io CLI: https://fly.io/docs/flyctl/
- Volumes: https://fly.io/docs/volumes/
- Pricing: https://fly.io/docs/about/pricing/

---

## ✅ Checklist Final

Antes de considerar o deploy completo, verifique:

- [ ] CLI do Fly.io instalada e logada
- [ ] Aplicação criada no Fly.io
- [ ] Volume persistente criado
- [ ] Secrets configurados (API_KEY e CRM_WEBHOOK_URL)
- [ ] Deploy realizado com sucesso
- [ ] Health check passando
- [ ] Logs sem erros
- [ ] URL pública funcionando
- [ ] Frontend atualizado com BAILEYS_SERVER_URL
- [ ] Teste de conexão WhatsApp funcionando

---

## 🎉 Pronto!

Seu servidor Baileys está rodando no Fly.io gratuitamente! 🚀

**Próximos passos:**
1. Acesse seu frontend
2. Vá em configurações de WhatsApp
3. Clique em "Conectar"
4. Escaneie o QR Code
5. Comece a usar!

---

**Dúvidas?** Consulte os logs com `fly logs` ou a documentação oficial do Fly.io.

