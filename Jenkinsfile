pipeline {
  agent any
  tools { nodejs 'NodeJS-22' }
  stages {
    stage('Install') {
      steps {
        sh 'npm install'
        sh 'npm run install:all'
        sh 'python -m pip install -r ai-service/requirements.txt'
      }
    }
    stage('Test') {
      parallel {
        stage('API Tests') { steps { sh 'npm test' } }
        stage('AI Tests') { steps { sh 'python -m pytest ai-service -q' } }
      }
    }
    stage('Build') { steps { sh 'npm run build' } }
    stage('Container Validation') { steps { sh 'docker compose config' } }
  }
  post { always { archiveArtifacts artifacts: 'client/dist/**', allowEmptyArchive: true } }
}
