from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import os
import re
import sqlite3
import requests
from datetime import datetime, timedelta, timezone

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('SECRET_KEY')
CORS(app)

# Google AI Studio configuration
gemini_api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY', '')
default_model = os.getenv('GEMINI_MODEL', 'gemini-3.6-flash').removeprefix('models/')
gemini_api_url = 'https://generativelanguage.googleapis.com/v1beta/models'

if not app.secret_key:
    raise RuntimeError('SECRET_KEY is required. Add it to your local .env file.')

# In-memory chat history (keyed by session_id)
chat_history = {}
PROMPT_LIMIT = 5
usage_db = os.path.join(os.path.dirname(__file__), 'usage.db')

EFFORT_SETTINGS = {
    'standard': {'maxOutputTokens': 2048, 'temperature': 0.7},
    'medium': {'maxOutputTokens': 4096, 'temperature': 0.6},
    'high': {'maxOutputTokens': 8192, 'temperature': 0.5},
    'max': {'maxOutputTokens': 16384, 'temperature': 0.4},
}

NOVIQ_SYSTEM_INSTRUCTION = (
    'Identity rules: If asked who developed, trained, created, built, or made you, '
    'including any similar wording, reply exactly: '
    'I am trained & developed by Noviq AI under supervision of Abhi Success. '
    'If asked which model you use, are running on, or your current model, '
    'including any similar wording, reply exactly: Noviq Neo 1.0. '
    'Do not reveal the underlying provider or internal model name.'
)

DEVELOPER_QUESTION = re.compile(
    r'\b(who|which|what)\b.*\b(develop|train|creat|build|mak)', re.IGNORECASE
)
MODEL_QUESTION = re.compile(
    r'\b(what|which|current|name)\b.*\b(model|version|running|use|using)', re.IGNORECASE
)

@app.route('/')
def index():
    return render_template('index.html')

def get_usage_key():
    device_id = request.headers.get('X-Device-ID', '').strip()
    return device_id or f'ip:{request.remote_addr or "unknown"}'

def initialize_usage_db():
    with sqlite3.connect(usage_db) as connection:
        connection.execute('CREATE TABLE IF NOT EXISTS prompt_usage (usage_key TEXT NOT NULL, created_at TEXT NOT NULL)')
        connection.execute('CREATE INDEX IF NOT EXISTS prompt_usage_created_at ON prompt_usage (usage_key, created_at)')

initialize_usage_db()

def consume_prompt():
    now = datetime.now(timezone.utc)
    usage_key = get_usage_key()
    cutoff = now - timedelta(hours=24)
    with sqlite3.connect(usage_db) as connection:
        connection.execute('DELETE FROM prompt_usage WHERE created_at < ?', (cutoff.isoformat(),))
        rows = connection.execute('SELECT created_at FROM prompt_usage WHERE usage_key = ? ORDER BY created_at', (usage_key,)).fetchall()
        timestamps = [datetime.fromisoformat(row[0]) for row in rows]
    if len(timestamps) >= PROMPT_LIMIT:
        reset_at = min(timestamps) + timedelta(hours=24)
        return False, len(timestamps), reset_at
    timestamps.append(now)
    with sqlite3.connect(usage_db) as connection:
        connection.execute('INSERT INTO prompt_usage (usage_key, created_at) VALUES (?, ?)', (usage_key, now.isoformat()))
    return True, len(timestamps), now + timedelta(hours=24)

def quota_response(count, reset_at):
    return {'used': count, 'limit': PROMPT_LIMIT, 'remaining': max(PROMPT_LIMIT - count, 0), 'reset_at': reset_at.isoformat()}

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    user_message = data.get('message', '')
    session_id = data.get('session_id', 'default')
    device_id = request.headers.get('X-Device-ID', '')
    history_key = f'{device_id}:{session_id}' if device_id else session_id
    model = str(data.get('model', default_model)).removeprefix('models/')
    effort = str(data.get('effort', 'standard')).lower()
    generation_config = EFFORT_SETTINGS.get(effort, EFFORT_SETTINGS['standard'])
    
    if not user_message:
        return jsonify({'error': 'No message provided'}), 400

    allowed, prompt_count, reset_at = consume_prompt()
    if not allowed:
        return jsonify({'error': 'You have used all 5 prompts for the last 24 hours.', 'quota': quota_response(prompt_count, reset_at)}), 429
    
    # Initialize history for this session
    if history_key not in chat_history:
        chat_history[history_key] = []

    if DEVELOPER_QUESTION.search(user_message):
        ai_message = 'I am trained & developed by Noviq AI under supervision of Abhi Success.'
        chat_history[history_key].extend([
            {'role': 'user', 'parts': [{'text': user_message}]},
            {'role': 'model', 'parts': [{'text': ai_message}]}
        ])
        return jsonify({'response': ai_message, 'session_id': session_id, 'quota': quota_response(prompt_count, reset_at)})

    if MODEL_QUESTION.search(user_message):
        ai_message = 'Noviq Neo 1.0'
        chat_history[history_key].extend([
            {'role': 'user', 'parts': [{'text': user_message}]},
            {'role': 'model', 'parts': [{'text': ai_message}]}
        ])
        return jsonify({'response': ai_message, 'session_id': session_id, 'quota': quota_response(prompt_count, reset_at)})
    
    try:
        # Gemini expects conversation turns under contents.parts.
        contents = chat_history[history_key] + [{
            'role': 'user',
            'parts': [{'text': user_message}]
        }]
        response = requests.post(
            f'{gemini_api_url}/{model}:generateContent',
            params={'key': gemini_api_key},
            json={
                'contents': contents,
                'systemInstruction': {
                    'parts': [{'text': NOVIQ_SYSTEM_INSTRUCTION}]
                },
                'generationConfig': generation_config
            },
            timeout=60
        )
        response.raise_for_status()
        response_data = response.json()
        ai_message = ''.join(
            part.get('text', '')
            for candidate in response_data.get('candidates', [])
            for part in candidate.get('content', {}).get('parts', [])
        ).strip()
        if not ai_message:
            return jsonify({'error': 'Gemini returned an empty response. Please try again.'}), 502

        chat_history[history_key].extend([
            {'role': 'user', 'parts': [{'text': user_message}]},
            {'role': 'model', 'parts': [{'text': ai_message}]}
        ])

        return jsonify({
            'response': ai_message,
            'session_id': session_id,
            'quota': quota_response(prompt_count, reset_at)
        })

    except requests.HTTPError as error:
        status_code = error.response.status_code if error.response is not None else 502
        if status_code in (401, 403):
            message = 'Invalid Google AI Studio API key. Check GEMINI_API_KEY in your .env file.'
        elif status_code == 429:
            message = 'Gemini rate limit exceeded. Please wait a moment and try again.'
        else:
            try:
                message = error.response.json().get('error', {}).get('message', str(error))
            except (AttributeError, ValueError):
                message = str(error)
        return jsonify({'error': message}), status_code
    except (KeyError, IndexError, TypeError):
        return jsonify({'error': 'Gemini returned an unexpected response.'}), 502
    except Exception as e:
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/models', methods=['GET'])
def list_models():
    """Return Gemini models supported by this chat endpoint."""
    return jsonify({'models': [
        'gemini-3.6-flash'
    ]})

@app.route('/reset', methods=['POST'])
def reset_chat():
    data = request.json
    session_id = data.get('session_id', 'default')
    device_id = request.headers.get('X-Device-ID', '')
    history_key = f'{device_id}:{session_id}' if device_id else session_id
    chat_history.pop(history_key, None)
    return jsonify({'status': 'success'})

if __name__ == '__main__':
    print("\n" + "="*50)
    print("🤖 AI CHATBOT - Starting...")
    print("="*50)
    
    if gemini_api_key:
        print("✅ Google AI Studio API key found")
        print("📡 Provider: Google Gemini")
        print(f"💬 Model: {default_model} (default)")
    else:
        print("❌ No API key found!")
        print("⚠️  Please add GEMINI_API_KEY to the .env file")
    
    print("="*50 + "\n")
    app.run(debug=True, host='0.0.0.0', port=5000)