import { Module } from "@nestjs/common"
import { GitDbController } from "./gitdb.controller.js"

@Module({
  controllers: [GitDbController],
})
export class AppModule {}
