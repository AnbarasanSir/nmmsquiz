import sys
import os

# Add application directory to Python system path
APP_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, APP_DIR)

# Import the Flask application instance
from app import app as application

if __name__ == '__main__':
    application.run(host='0.0.0.0', port=5000, debug=False)
