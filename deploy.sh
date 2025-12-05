#!/bin/bash

# Script de Deploy para Fly.io
# Este script automatiza o processo de deploy do Baileys Server

set -e

echo "🚀 Deploy do Baileys Server no Fly.io"
echo "======================================"
echo ""

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Verificar se fly CLI está instalado
if ! command -v fly &> /dev/null; then
    echo -e "${RED}❌ Fly CLI não encontrada!${NC}"
    echo ""
    echo "Instale com:"
    echo "  Linux/macOS: curl -L https://fly.io/install.sh | sh"
    echo "  Windows: powershell -Command \"iwr https://fly.io/install.ps1 -useb | iex\""
    exit 1
fi

echo -e "${GREEN}✅ Fly CLI encontrada${NC}"

# Verificar se está logado
if ! fly auth whoami &> /dev/null; then
    echo -e "${YELLOW}⚠️  Não está logado no Fly.io${NC}"
    echo ""
    echo "Fazendo login..."
    fly auth login
fi

echo -e "${GREEN}✅ Logado no Fly.io${NC}"

# Verificar se aplicação existe
APP_NAME="gdck-baileys-server"
if ! fly apps list | grep -q "$APP_NAME"; then
    echo -e "${YELLOW}⚠️  Aplicação $APP_NAME não existe${NC}"
    echo ""
    read -p "Deseja criar a aplicação? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Criando aplicação..."
        fly apps create "$APP_NAME" || {
            echo -e "${RED}❌ Erro ao criar aplicação${NC}"
            echo "Tente um nome diferente ou crie manualmente."
            exit 1
        }
        echo -e "${GREEN}✅ Aplicação criada${NC}"
    else
        echo "Cancelado."
        exit 0
    fi
fi

# Verificar se volume existe
if ! fly volumes list --app "$APP_NAME" | grep -q "whatsapp_auth_data"; then
    echo -e "${YELLOW}⚠️  Volume não encontrado${NC}"
    echo ""
    read -p "Deseja criar o volume? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Criando volume..."
        fly volumes create whatsapp_auth_data --region gru --size 1 --app "$APP_NAME"
        echo -e "${GREEN}✅ Volume criado${NC}"
    else
        echo -e "${RED}❌ Volume é necessário para persistir sessões WhatsApp${NC}"
        exit 1
    fi
fi

# Verificar secrets
echo ""
echo "Verificando secrets..."
if ! fly secrets list --app "$APP_NAME" | grep -q "API_KEY"; then
    echo -e "${YELLOW}⚠️  API_KEY não configurada${NC}"
    read -p "Digite a API_KEY (ou Enter para pular): " api_key
    if [ -n "$api_key" ]; then
        fly secrets set API_KEY="$api_key" --app "$APP_NAME"
        echo -e "${GREEN}✅ API_KEY configurada${NC}"
    fi
fi

if ! fly secrets list --app "$APP_NAME" | grep -q "CRM_WEBHOOK_URL"; then
    echo -e "${YELLOW}⚠️  CRM_WEBHOOK_URL não configurada${NC}"
    read -p "Digite a CRM_WEBHOOK_URL: " webhook_url
    if [ -n "$webhook_url" ]; then
        fly secrets set CRM_WEBHOOK_URL="$webhook_url" --app "$APP_NAME"
        echo -e "${GREEN}✅ CRM_WEBHOOK_URL configurada${NC}"
    fi
fi

# Deploy
echo ""
echo "Iniciando deploy..."
echo ""
fly deploy --app "$APP_NAME"

echo ""
echo -e "${GREEN}✅ Deploy concluído!${NC}"
echo ""
echo "📊 Ver logs:"
echo "  fly logs --app $APP_NAME"
echo ""
echo "🌐 URL da aplicação:"
fly info --app "$APP_NAME" | grep "Hostname" | awk '{print "  https://" $3}'
echo ""
echo "🎉 Pronto para usar!"

