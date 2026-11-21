@echo off
cd /d "%~dp0"
if not exist out mkdir out
echo Compilando...
javac -encoding UTF-8 -cp lib\ojdbc8.jar -d out src\Servidor.java
if errorlevel 1 (
  echo.
  echo ERROR al compilar. Si dice que javac no se reconoce, falta instalar el JDK de Java.
  pause
  exit /b 1
)
echo Iniciando servidor...
java -cp "out;lib\ojdbc8.jar" Servidor
pause
