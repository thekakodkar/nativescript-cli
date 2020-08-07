
import { IDoctorService } from "../common/declarations";
import { ICommand, ICommandParameter } from "../common/definitions/commands";

export class SetupCommand implements ICommand {
	public allowedParameters: ICommandParameter[] = [];

	constructor(private $doctorService: IDoctorService) { }

	public execute(args: string[]): Promise<any> {
		return this.$doctorService.runSetupScript();
	}
}
$injector.registerCommand("setup|*", SetupCommand);
